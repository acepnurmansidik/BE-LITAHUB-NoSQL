const { runWithOptionalTransaction } = require("../../helper/crudService");
const { generateSequenceNo } = require("../../helper/sequence");
const {
  syncGoodReceiptItems,
  reconcileGoodReceiptStock,
} = require("../../helper/DetailProductItems");
const BadRequest = require("../../utils/errors/bad-request");
const LogActionModel = require("../models/LogAction.model");
const GoodReceiptModel = require("../models/GoodReceipt.model");
const PurchaseOrderModel = require("../models/PurchaseOrder.model");
const DetailProductItemModel = require("../models/DetailProductItem.model");
const PurchaseRequestModel = require("../models/PurchaseRequest.model");

const controller = {};
const MODULE_NAME = GoodReceiptModel.collection.collectionName;

const FILTER_STATUSES = ["DRAFT", "PARTIAL", "RECEIVED"];

const ITEM_POPULATE = {
  path: "items",
  match: { is_delete: { $ne: true } },
  populate: [
    { path: "product_id", select: "code name" },
    { path: "uom_id", select: "code name" },
    { path: "supplier_id", select: "code name" },
    { path: "warehouse_id", select: "code name" },
  ],
};

// Validasi daftar PO yang diterima. Semua harus ada & sudah SUBMITTED.
const validatePurchaseOrders = async (poIds, session) => {
  const ids = [...new Set((poIds || []).filter(Boolean).map(String))];
  if (ids.length < 1) {
    throw new BadRequest("At least 1 purchase order is required.");
  }
  const pos = await PurchaseOrderModel.find({
    _id: { $in: ids },
    is_delete: { $ne: true },
  }).session(session ?? null);
  if (pos.length !== ids.length) {
    throw new BadRequest("Some purchase orders were not found.");
  }
  for (const po of pos) {
    if (!["SUBMITTED", "PARTIAL_RECEIVED"].includes(po.status)) {
      throw new BadRequest(`PO ${po.order_no} must be submitted first.`);
    }
  }
  return ids;
};

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['GOOD RECEIPT']
    #swagger.parameters['page'] = { default: 1 }
    #swagger.parameters['limit'] = { default: 10 }
    #swagger.parameters['search'] = { default: '', description: 'receipt_no / reference / description' }
    #swagger.parameters['status'] = { default: '', description: 'DRAFT | PARTIAL | RECEIVED' }
  */
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { search, status } = req.query;

    const baseQuery = { is_delete: { $ne: true } };
    if (search) {
      baseQuery["$or"] = [
        { receipt_no: { $regex: search, $options: "i" } },
        { reference: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const query = { ...baseQuery };
    if (status && FILTER_STATUSES.includes(String(status).toUpperCase())) {
      query.status = String(status).toUpperCase();
    }

    const [data, total, counts] = await Promise.all([
      GoodReceiptModel.find(query)
        .sort({ date: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate(ITEM_POPULATE)
        .populate("po_ids", "order_no")
        .populate("warehouse_id", "code name")
        .select("-is_delete"),
      GoodReceiptModel.countDocuments(query),
      GoodReceiptModel.aggregate([
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
    #swagger.tags = ['GOOD RECEIPT']
    #swagger.parameters['id'] = { description: 'id good receipt' }
  */
  try {
    const data = await GoodReceiptModel.findOne({
      _id: req.params.id,
      is_delete: { $ne: true },
    })
      .populate(ITEM_POPULATE)
      .populate("po_ids", "order_no")
      .populate("warehouse_id", "code name")
      .select("-is_delete");
    if (!data) throw new BadRequest("Data not found!");
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
    #swagger.tags = ['GOOD RECEIPT']
    #swagger.summary = 'Buat good receipt. Item MEMAKAI ULANG detail dari PO (tidak bikin baru).'
  */
  try {
    const payload = req.body;
    const date = payload.date ? new Date(payload.date) : new Date();
    if (Number.isNaN(date.getTime())) throw new BadRequest("Invalid date.");
    let receivedDate = null;
    if (payload.received_date) {
      receivedDate = new Date(payload.received_date);
      if (Number.isNaN(receivedDate.getTime())) {
        throw new BadRequest("Invalid received date.");
      }
    }
    const mode = String(payload.warehouse_mode || "SINGLE").toUpperCase();

    const result = await runWithOptionalTransaction(async (session) => {
      const poIds = await validatePurchaseOrders(payload.po_ids, session);
      const receipt_no = await generateSequenceNo({
        module: MODULE_NAME,
        prefix: "GR",
        date,
        session,
      });

      const [doc] = await GoodReceiptModel.create(
        [
          {
            receipt_no,
            date,
            status: "DRAFT",
            received_date: receivedDate,
            reference: String(payload.reference ?? "").trim(),
            description: String(payload.description ?? "").trim(),
            po_ids: poIds,
            warehouse_id: mode === "SINGLE" ? payload.warehouse_id : null,
            warehouse_mode: mode,
            total_amount: 0,
          },
        ],
        { session },
      );

      // Reuse detail PO (shared doc) — set good_receipt_id/received_qty/warehouse.
      const { total, status } = await syncGoodReceiptItems({
        grId: doc._id,
        payloadItems: payload.items,
        mode,
        headerWarehouse: payload.warehouse_id,
        session,
      });
      doc.total_amount = total;
      doc.status = status;
      await doc.save({ session });

      // received_qty -> stok (position + movement) direkonsiliasi.
      await reconcileGoodReceiptStock({ grId: doc._id, session });

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

      const newData = await GoodReceiptModel.findById(doc._id)
        .populate(ITEM_POPULATE)
        .populate("po_ids", "order_no")
        .populate("warehouse_id", "code name")
        .session(session);

      if (newData.status === "RECEIVED") {
        const detailIds = await DetailProductItemModel.find({
          good_receipt_id: newData._id,
          is_delete: { $new },
        }).session(session);

        const dataPO = new Set(
          detailIds
            .filter((item) => item.purchase_order_id !== null)
            .map((item) => item.purchase_order_id),
        );
        const dataPR = new Set(
          detailIds
            .filter((item) => item.purchase_request_id !== null)
            .map((item) => item.purchase_request_id),
        );

        await Promise.all([
          PurchaseOrderModel.updateMany(
            { _id: { $in: dataPO } },
            { status: "CLOSED" },
            { session },
          ),
          PurchaseRequestModel.updateMany(
            { _id: { $in: dataPR } },
            { status: "CLOSED" },
            { session },
          ),
        ]);
      }

      return newData;
    });

    res.status(201).json({
      code: 201,
      success: true,
      message: "Good receipt created successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.update = async (req, res, next) => {
  /*
    #swagger.tags = ['GOOD RECEIPT']
    #swagger.summary = 'Perbarui GR (status otomatis dari received_qty).'
    #swagger.parameters['id'] = { description: 'id good receipt' }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await GoodReceiptModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new BadRequest("Data not found!");

      const before = doc.toObject();

      if (payload.date !== undefined) {
        const date = new Date(payload.date);
        if (Number.isNaN(date.getTime())) throw new BadRequest("Invalid date.");
        doc.date = date;
      }
      if (payload.received_date !== undefined) {
        if (payload.received_date) {
          const rd = new Date(payload.received_date);
          if (Number.isNaN(rd.getTime())) {
            throw new BadRequest("Invalid received date.");
          }
          doc.received_date = rd;
        } else {
          doc.received_date = null;
        }
      }
      if (payload.reference !== undefined) {
        doc.reference = String(payload.reference).trim();
      }
      if (payload.description !== undefined) {
        doc.description = String(payload.description).trim();
      }
      if (payload.po_ids !== undefined) {
        doc.po_ids = await validatePurchaseOrders(payload.po_ids, session);
      }
      if (payload.warehouse_mode !== undefined) {
        doc.warehouse_mode = String(payload.warehouse_mode).toUpperCase();
      }
      if (payload.warehouse_id !== undefined) {
        doc.warehouse_id = payload.warehouse_id || null;
      }

      // Bangun ulang item (reuse PO) + stok + status bila item/warehouse/mode berubah.
      if (
        payload.items !== undefined ||
        payload.warehouse_mode !== undefined ||
        payload.warehouse_id !== undefined
      ) {
        let payloadItems = payload.items;
        if (payloadItems === undefined) {
          // Item tak dikirim: pakai item existing sebagai basis (reuse dirinya).
          const existing = await DetailProductItemModel.find({
            good_receipt_id: doc._id,
            is_delete: { $ne: true },
          }).session(session);
          payloadItems = existing.map((d) => ({
            source_item_ids:
              d.purchase_order_id || d.purchase_request_id
                ? [String(d._id)]
                : [],
            product_id: d.product_id,
            uom_id: d.uom_id,
            supplier_id: d.supplier_id,
            quantity: d.quantity,
            price: d.price,
            received_qty: d.received_qty,
            warehouse_id: d.warehouse_id,
          }));
        }
        const { total, status } = await syncGoodReceiptItems({
          grId: doc._id,
          payloadItems,
          mode: doc.warehouse_mode,
          headerWarehouse: doc.warehouse_id,
          session,
        });
        doc.total_amount = total;
        doc.status = status;
        await reconcileGoodReceiptStock({ grId: doc._id, session });
      }

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

      return GoodReceiptModel.findById(doc._id)
        .populate(ITEM_POPULATE)
        .populate("po_ids", "order_no")
        .populate("warehouse_id", "code name")
        .session(session);
    });

    res.status(200).json({
      code: 200,
      success: true,
      message: "Good receipt updated successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.delete = async (req, res, next) => {
  /*
    #swagger.tags = ['GOOD RECEIPT']
    #swagger.summary = 'Hapus GR (soft delete). Item PO di-detach (tidak dihapus), stok dikembalikan.'
    #swagger.parameters['id'] = { description: 'id good receipt' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await GoodReceiptModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new BadRequest("Data not found!");

      const before = doc.toObject();
      doc.is_delete = true;
      await doc.save({ session });

      // Item milik PO/PR di-detach (dikembalikan); item GR-only dihapus.
      await DetailProductItemModel.updateMany(
        {
          good_receipt_id: doc._id,
          $or: [
            { purchase_order_id: { $ne: null } },
            { purchase_request_id: { $ne: null } },
          ],
        },
        { $set: { good_receipt_id: null, received_qty: 0 } },
      ).session(session);
      await DetailProductItemModel.deleteMany({
        good_receipt_id: doc._id,
        purchase_order_id: null,
        purchase_request_id: null,
      }).session(session);

      // Kembalikan stok (reverse movement GR).
      await reconcileGoodReceiptStock({ grId: doc._id, session });

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
      message: "Good receipt deleted successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = controller;
