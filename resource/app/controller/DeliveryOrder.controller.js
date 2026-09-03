const { runWithOptionalTransaction } = require("../../helper/crudService");
const { generateSequenceNo } = require("../../helper/sequence");
const {
  buildDetailProductItems,
  syncDetailProductItems,
  reconcileDeliveryOrderStock,
  releaseDeliveryOrderStock,
} = require("../../helper/DetailProductItems");
const BadRequest = require("../../utils/errors/bad-request");
const LogActionModel = require("../models/LogAction.model");
const DeliveryOrderModel = require("../models/DeliveryOrder.model");
const DetailProductItemModel = require("../models/DetailProductItem.model");
const NotFound = require("../../utils/errors/not-found");

const controller = {};
const STATUSES = ["PENDING", "SHIPPED"];
const WAREHOUSE_MODES = ["SINGLE", "MULTIPLE"];
const MODULE_NAME = DeliveryOrderModel.collection.collectionName;

// Tetapkan gudang sumber tiap baris item sesuai warehouse_mode:
//  - SINGLE   : semua item memakai gudang header (headerWarehouse),
//  - MULTIPLE : tiap item memakai warehouse_id-nya sendiri (WAJIB diisi).
// Mengembalikan array item baru yang sudah ternormalisasi warehouse_id-nya.
const normalizeDoItems = (rawItems, mode, headerWarehouse) => {
  const list = Array.isArray(rawItems) ? rawItems : [];
  return list.map((it, index) => {
    const warehouse_id =
      mode === "SINGLE" ? headerWarehouse || null : it.warehouse_id || null;
    if (mode === "MULTIPLE" && !warehouse_id) {
      throw new BadRequest(
        `Item ${index + 1}: source warehouse is required in multi-warehouse mode.`,
      );
    }
    return { ...it, warehouse_id };
  });
};

const ITEM_POPULATE = {
  path: "items",
  match: { is_delete: { $ne: true } },
  populate: [
    { path: "product_id", select: "code name" },
    { path: "uom_id", select: "code name" },
    { path: "warehouse_id", select: "code name" },
  ],
};

// Kirim (populate lengkap) satu DO by id.
const findDoPopulated = (id, session) =>
  DeliveryOrderModel.findById(id)
    .populate(ITEM_POPULATE)
    .populate("warehouse_id", "code name")
    .session(session ?? null);

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['Delivery Order']
    #swagger.summary = 'List Delivery Orders'
    #swagger.description = 'Return a paginated list of delivery orders with optional search and status filters.'
    #swagger.parameters['page'] = { default: 1 }
    #swagger.parameters['limit'] = { default: 10 }
    #swagger.parameters['search'] = { default: '', description: 'delivery_no / reference / recipient / description' }
    #swagger.parameters['status'] = { default: '', description: 'PENDING | SHIPPED' }
  */
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { search, status } = req.query;

    const baseQuery = { is_delete: { $ne: true } };
    if (search) {
      baseQuery["$or"] = [
        { delivery_no: { $regex: search, $options: "i" } },
        { reference: { $regex: search, $options: "i" } },
        { recipient: { $regex: search, $options: "i" } },
      ];
    }

    const query = { ...baseQuery };
    if (status && STATUSES.includes(String(status).toUpperCase())) {
      query.status = String(status).toUpperCase();
    }

    const [data, total, counts] = await Promise.all([
      DeliveryOrderModel.find(query)
        .sort({ date: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate(ITEM_POPULATE)
        .populate("warehouse_id", "code name")
        .select("-is_delete"),
      DeliveryOrderModel.countDocuments(query),
      DeliveryOrderModel.aggregate([
        { $match: baseQuery },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    // { STATUS: jumlah, ... } + total keseluruhan (mengikuti filter search).
    const status_counts = counts.reduce(
      (acc, c) => {
        if (c._id) acc[c._id] = c.count;
        acc.ALL += c.count;
        return acc;
      },
      { ALL: 0 },
    );

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: total,
      current_page: page,
      status_counts,
    });
  } catch (err) {
    next(err);
  }
};

controller.show = async (req, res, next) => {
  /*
    #swagger.tags = ['Delivery Order']
    #swagger.summary = 'Get Delivery Order detail'
    #swagger.description = 'Return a single delivery order with its detail items by id.'
    #swagger.parameters['id'] = { description: 'delivery order id' }
  */
  try {
    const data = await DeliveryOrderModel.findOne({
      _id: req.params.id,
      is_delete: { $ne: true },
    })
      .populate(ITEM_POPULATE)
      .populate("warehouse_id", "code name")
      .select("-is_delete");
    if (!data) throw new NotFound("Data not found!");
    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
    });
  } catch (err) {
    next(err);
  }
};

controller.create = async (req, res, next) => {
  /*
    #swagger.tags = ['Delivery Order']
    #swagger.summary = 'Create Delivery Order'
    #swagger.description = 'Create a standalone delivery order (status PENDING). warehouse_mode SINGLE takes all items from the header warehouse_id; MULTIPLE takes each item from its own warehouse_id (required per item). Source-warehouse stock is reduced immediately on creation and stock-out movements are recorded; rejected if a product is not stocked in the chosen warehouse or the quantity exceeds what is available.'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create Delivery Order',
      schema: { $ref: '#/definitions/BodyDeliveryOrderSchema' }
    }
  */
  try {
    const payload = req.body;
    const date = payload.date ? new Date(payload.date) : new Date();
    if (Number.isNaN(date.getTime())) throw new BadRequest("Invalid date.");
    let deliveryDate = null;
    if (payload.delivery_date) {
      deliveryDate = new Date(payload.delivery_date);
      if (Number.isNaN(deliveryDate.getTime())) {
        throw new BadRequest("Invalid delivery date.");
      }
    }
    const mode = String(payload.warehouse_mode || "SINGLE").toUpperCase();
    if (!WAREHOUSE_MODES.includes(mode)) {
      throw new BadRequest("Invalid warehouse mode (SINGLE | MULTIPLE).");
    }
    // SINGLE butuh gudang header; MULTIPLE gudang ada di tiap item.
    if (mode === "SINGLE" && !payload.warehouse_id) {
      throw new BadRequest("Source warehouse is required.");
    }
    const headerWarehouse = mode === "SINGLE" ? payload.warehouse_id : null;

    const result = await runWithOptionalTransaction(async (session) => {
      // Item DO: hanya butuh product + quantity (tanpa nilai uang). Gudang
      // sumber tiap item ditetapkan sesuai mode sebelum divalidasi.
      const normItems = normalizeDoItems(payload.items, mode, headerWarehouse);
      const { items } = await buildDetailProductItems(normItems, session, {
        noDuplicate: true,
      });
      const delivery_no = await generateSequenceNo({
        module: MODULE_NAME,
        prefix: "DO",
        date,
        session,
      });

      const [doc] = await DeliveryOrderModel.create(
        [
          {
            delivery_no,
            date,
            delivery_date: deliveryDate,
            recipient: String(payload.recipient ?? "").trim(),
            reference: String(payload.reference ?? "").trim(),
            description: String(payload.description ?? "").trim(),
            warehouse_id: headerWarehouse,
            warehouse_mode: mode,
            status: "PENDING",
            created_by: req?.login?.user_id ?? null,
          },
        ],
        { session },
      );

      await syncDetailProductItems({
        parentField: "delivery_order_id",
        parentId: doc._id,
        items,
        session,
      });

      // Stok gudang sumber langsung berkurang saat DO dibuat (status PENDING).
      await reconcileDeliveryOrderStock({ doId: doc._id, session });

      await LogActionModel.create(
        [
          {
            target_id: doc._id,
            source: MODULE_NAME,
            activities: [
              {
                type: "CREATE",
                after: doc.toObject(),
                created_by: req?.login?.user_id ?? null,
              },
            ],
          },
        ],
        { session },
      );

      return findDoPopulated(doc._id, session);
    });

    res.status(201).json({
      code: 201,
      success: true,
      message: "Delivery order created successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.update = async (req, res, next) => {
  /*
    #swagger.tags = ['Delivery Order']
    #swagger.summary = 'Update Delivery Order'
    #swagger.description = 'Update a pending delivery order. Locked once shipped.'
    #swagger.parameters['id'] = { description: 'delivery order id' }
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Update Delivery Order',
      schema: { $ref: '#/definitions/BodyDeliveryOrderSchema' }
    }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await DeliveryOrderModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new NotFound("Data not found!");
      // Dikunci setelah barang dikirim.
      if (doc.status === "SHIPPED") {
        throw new BadRequest("Shipped delivery order is locked.");
      }

      const before = doc.toObject();

      if (payload.date !== undefined) {
        const date = new Date(payload.date);
        if (Number.isNaN(date.getTime())) throw new BadRequest("Invalid date.");
        doc.date = date;
      }
      if (payload.delivery_date !== undefined) {
        if (payload.delivery_date) {
          const dd = new Date(payload.delivery_date);
          if (Number.isNaN(dd.getTime())) {
            throw new BadRequest("Invalid delivery date.");
          }
          doc.delivery_date = dd;
        } else {
          doc.delivery_date = null;
        }
      }
      if (payload.recipient !== undefined) {
        doc.recipient = String(payload.recipient).trim();
      }
      if (payload.reference !== undefined) {
        doc.reference = String(payload.reference).trim();
      }
      if (payload.description !== undefined) {
        doc.description = String(payload.description).trim();
      }
      if (payload.warehouse_mode !== undefined) {
        const m = String(payload.warehouse_mode).toUpperCase();
        if (!WAREHOUSE_MODES.includes(m)) {
          throw new BadRequest("Invalid warehouse mode (SINGLE | MULTIPLE).");
        }
        doc.warehouse_mode = m;
      }
      if (payload.warehouse_id !== undefined) {
        doc.warehouse_id = payload.warehouse_id || null;
      }
      // Jaga konsistensi header sesuai mode terkini.
      if (doc.warehouse_mode === "SINGLE" && !doc.warehouse_id) {
        throw new BadRequest("Source warehouse is required.");
      }
      if (doc.warehouse_mode === "MULTIPLE") {
        doc.warehouse_id = null;
      }
      if (payload.items !== undefined) {
        // Tetapkan gudang tiap item sesuai mode final dokumen.
        const normItems = normalizeDoItems(
          payload.items,
          doc.warehouse_mode,
          doc.warehouse_id,
        );
        const { items } = await buildDetailProductItems(normItems, session, {
          noDuplicate: true,
        });
        await syncDetailProductItems({
          parentField: "delivery_order_id",
          parentId: doc._id,
          items,
          session,
        });
      }

      await doc.save({ session });

      // Rekonsiliasi stok: balikkan movement lama lalu terapkan ulang sesuai
      // item & gudang terbaru (idempoten; menangani perubahan qty/gudang/item).
      await reconcileDeliveryOrderStock({ doId: doc._id, session });

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: { target_id: id, source: MODULE_NAME },
          $push: {
            activities: {
              type: "UPDATE",
              before,
              after: doc.toObject(),
              created_by: req?.login?.user_id ?? null,
            },
          },
        },
        { upsert: true, session },
      );

      return findDoPopulated(doc._id, session);
    });

    res.status(200).json({
      code: 200,
      success: true,
      message: "Delivery order updated successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

// ============================================================
// KIRIM BARANG — PENDING -> SHIPPED. Stok gudang sumber SUDAH berkurang sejak
// DO dibuat, jadi aksi ini hanya menandai dokumen terkirim & menguncinya
// (tidak lagi bisa diedit/dihapus). Tidak ada perubahan stok di sini.
// ============================================================
controller.ship = async (req, res, next) => {
  /*
    #swagger.tags = ['Delivery Order']
    #swagger.summary = 'Ship Delivery Order (Kirim Barang)'
    #swagger.description = 'Mark a pending delivery order as shipped and lock it. Stock was already reduced at creation, so this only flips the status.'
    #swagger.parameters['id'] = { description: 'delivery order id' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await DeliveryOrderModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new BadRequest("Data not found!");
      if (doc.status === "SHIPPED") {
        throw new BadRequest("Delivery order is already shipped.");
      }

      const before = doc.toObject();
      doc.status = "SHIPPED";
      await doc.save({ session });

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: { target_id: id, source: MODULE_NAME },
          $push: {
            activities: {
              type: "UPDATE",
              before,
              after: doc.toObject(),
              created_by: req?.login?.user_id ?? null,
            },
          },
        },
        { upsert: true, session },
      );

      return findDoPopulated(doc._id, session);
    });

    res.status(200).json({
      code: 200,
      success: true,
      message: "Delivery order shipped successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.delete = async (req, res, next) => {
  /*
    #swagger.tags = ['Delivery Order']
    #swagger.summary = 'Delete Delivery Order (soft delete)'
    #swagger.description = 'Soft delete a pending delivery order: restore the stock it reduced, then remove its detail items. Rejected once shipped.'
    #swagger.parameters['id'] = { description: 'delivery order id' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await DeliveryOrderModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new NotFound("Data not found!");
      if (doc.status === "SHIPPED") {
        throw new BadRequest("Shipped delivery order cannot be deleted.");
      }

      const before = doc.toObject();
      // Kembalikan stok yang tadi dikurangi DO ini sebelum dihapus.
      await releaseDeliveryOrderStock({ doId: doc._id, session });
      doc.is_delete = true;
      await doc.save({ session });
      // Buang item detailnya (DO standalone — tidak ada induk lain).
      await DetailProductItemModel.deleteMany({
        delivery_order_id: doc._id,
      }).session(session);

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: { target_id: id, source: MODULE_NAME },
          $push: {
            activities: {
              type: "DELETE",
              before,
              after: doc.toObject(),
              created_by: req?.login?.user_id ?? null,
            },
          },
        },
        { upsert: true, session },
      );

      return doc;
    });

    res.status(200).json({
      code: 200,
      success: true,
      message: "Delivery order deleted successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = controller;
