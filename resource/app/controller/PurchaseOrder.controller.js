const { runWithOptionalTransaction } = require("../../helper/crudService");
const { generateSequenceNo } = require("../../helper/sequence");
const {
  syncPurchaseOrderItems,
  linkItemsToPurchaseOrder,
  syncParentStatuses,
} = require("../../helper/DetailProductItems");
const BadRequest = require("../../utils/errors/bad-request");
const LogActionModel = require("../models/LogAction.model");
const PurchaseOrderModel = require("../models/PurchaseOrder.model");
const PurchaseRequestModel = require("../models/PurchaseRequest.model");
const DetailProductItemModel = require("../models/DetailProductItem.model");

const controller = {};
const STATUSES = ["DRAFT", "SUBMITTED"];
// Seluruh status valid — dipakai untuk filter list & hitung jumlah per status.
const FILTER_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "PARTIAL_RECEIVED",
  "RECEIVED",
  "CLOSED",
];
const MODULE_NAME = PurchaseOrderModel.collection.collectionName;

// PR bisa dipesan (dibuatkan PO) selama masih punya item PENDING, yaitu saat
// status SUBMITTED (belum dipesan) atau PARTIAL_ORDERED (sebagian dipesan).
const ORDERABLE_PR_STATUSES = [
  "SUBMITTED",
  "PARTIAL_ORDERED",
  "PARTIAL_RECEIVED",
];

// Validasi daftar PR sumber. Tiap PR harus ada & masih orderable. Karena satu
// PR kini bisa tertaut ke banyak PO (item dipecah per-supplier), tidak ada lagi
// pembatasan "sudah tertaut ke PO lain". Mengembalikan daftar id unik (string).
const validatePurchaseRequests = async ({ prIds, session }) => {
  const ids = [...new Set((prIds || []).filter(Boolean).map(String))];
  if (ids.length === 0) return [];

  const prs = await PurchaseRequestModel.find({
    _id: { $in: ids },
    is_delete: { $ne: true },
  }).session(session ?? null);
  if (prs.length !== ids.length) {
    throw new BadRequest("Some purchase requests were not found.");
  }
  for (const pr of prs) {
    if (!ORDERABLE_PR_STATUSES.includes(pr.status)) {
      throw new BadRequest(
        `PR ${pr.request_no} is not orderable (must be submitted or partially ordered).`,
      );
    }
  }
  return ids;
};

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['Purchase Order']
    #swagger.summary = 'List Purchase Orders'
    #swagger.description = 'Return a paginated list of purchase orders with optional search and status filters.'
    #swagger.parameters['page'] = { default: 1 }
    #swagger.parameters['limit'] = { default: 10 }
    #swagger.parameters['search'] = { default: '', description: 'order_no / reference / description' }
    #swagger.parameters['status'] = { default: '', description: 'DRAFT | SUBMITTED' }
  */
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { search, status } = req.query;

    // Query dasar (tanpa filter status) — dipakai juga untuk hitung jumlah
    // tiap status agar angka tetap tampil apa pun status yang dipilih.
    const baseQuery = { is_delete: { $ne: true } };
    if (search) {
      baseQuery["$or"] = [
        { order_no: { $regex: search, $options: "i" } },
        { reference: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const query = { ...baseQuery };
    if (status && FILTER_STATUSES.includes(String(status).toUpperCase())) {
      query.status = String(status).toUpperCase();
    }

    const [data, total, counts] = await Promise.all([
      PurchaseOrderModel.find(query)
        .sort({ date: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate({
          path: "items",
          match: { is_delete: { $ne: true } },
          populate: [
            { path: "product_id", select: "code name" },
            { path: "uom_id", select: "code name" },
            { path: "supplier_id", select: "code name" },
            { path: "purchase_request_id", select: "request_no" },
          ],
        })
        .populate("supplier_id", "code name")
        .select("-is_delete"),
      PurchaseOrderModel.countDocuments(query),
      PurchaseOrderModel.aggregate([
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
    #swagger.tags = ['Purchase Order']
    #swagger.summary = 'Get Purchase Order detail'
    #swagger.description = 'Return a single purchase order with its detail items by id.'
    #swagger.parameters['id'] = { description: 'purchase order id' }
  */
  try {
    const data = await PurchaseOrderModel.findOne({
      _id: req.params.id,
      is_delete: { $ne: true },
    })
      .populate({
        path: "items",
        match: { is_delete: { $ne: true } },
        populate: [
          { path: "product_id", select: "code name" },
          { path: "uom_id", select: "code name" },
          { path: "supplier_id", select: "code name" },
          { path: "purchase_request_id", select: "request_no" },
        ],
      })
      .populate("supplier_id", "code name")
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
    #swagger.tags = ['Purchase Order']
    #swagger.summary = 'Create Purchase Order'
    #swagger.description = 'Create a new purchase order (defaults to DRAFT status) from one or more purchase requests or manually.'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create Purchase Order',
      schema: { $ref: '#/definitions/BodyPurchaseOrderSchema' }
    }
  */
  try {
    const payload = req.body;
    const date = payload.date ? new Date(payload.date) : new Date();
    if (Number.isNaN(date.getTime())) throw new BadRequest("Invalid date.");
    let expectedDate = null;
    if (payload.expected_date) {
      expectedDate = new Date(payload.expected_date);
      if (Number.isNaN(expectedDate.getTime())) {
        throw new BadRequest("Invalid expected date.");
      }
    }

    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    if (rawItems.length < 1)
      throw new BadRequest("At least 1 item is required.");

    const result = await runWithOptionalTransaction(async (session) => {
      await validatePurchaseRequests({ prIds: payload.pr_ids, session });

      // Kelompokkan item per-supplier → satu PO per supplier ("" = tanpa
      // supplier). Item tanpa supplier tetap boleh dibuatkan PO (supplier null).
      const groups = new Map();
      for (const it of rawItems) {
        const key = it.supplier_id ? String(it.supplier_id) : "";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(it);
      }

      const createdPOs = [];
      const affectedPrIds = new Set();

      for (const [supplierKey, groupItems] of groups.entries()) {
        const order_no = await generateSequenceNo({
          module: MODULE_NAME,
          prefix: "PO",
          date,
          session,
        });
        const supplierId = supplierKey || null;

        const [doc] = await PurchaseOrderModel.create(
          [
            {
              order_no,
              date,
              expected_date: expectedDate,
              reference: String(payload.reference ?? "").trim(),
              description: String(payload.description ?? "").trim(),
              supplier_id: supplierId,
              // PO dibuat sebagai DRAFT dulu; disubmit manual dari daftar
              // sebelum bisa diterima di GR.
              status: "DRAFT",
              pr_ids: [],
              total_amount: 0,
              created_by: req?.login?.user_id ?? null,
            },
          ],
          { session },
        );

        // Tautkan item grup ke PO ini (status item → ORDERED).
        const { total, prIds } = await linkItemsToPurchaseOrder({
          poId: doc._id,
          supplierId,
          items: groupItems,
          session,
        });
        doc.total_amount = total;
        doc.pr_ids = prIds;
        await doc.save({ session });
        prIds.forEach((id) => affectedPrIds.add(id));
        createdPOs.push(doc);

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
      }

      // Recompute status PR sumber (ORDERED / PARTIAL_ORDERED) + array PO-nya.
      await syncParentStatuses({ prIds: [...affectedPrIds], session });

      return createdPOs;
    });

    res.status(201).json({
      code: 201,
      success: true,
      message:
        result.length > 1
          ? `${result.length} purchase orders created (grouped by supplier)!`
          : "Purchase order created successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.update = async (req, res, next) => {
  /*
    #swagger.tags = ['Purchase Order']
    #swagger.summary = 'Update Purchase Order / submit'
    #swagger.description = 'Update a purchase order or submit it (status DRAFT to SUBMITTED); locked once submitted.'
    #swagger.parameters['id'] = { description: 'purchase order id' }
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Update Purchase Order',
      schema: { $ref: '#/definitions/BodyPurchaseOrderSchema' }
    }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await PurchaseOrderModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new BadRequest("Data not found!");
      // Terkunci hanya bila barang sudah mulai diterima.
      if (["PARTIAL_RECEIVED", "RECEIVED", "CLOSED"].includes(doc.status)) {
        throw new BadRequest(
          "Purchase order already has received goods and cannot be edited.",
        );
      }

      const before = doc.toObject();

      if (payload.date !== undefined) {
        const date = new Date(payload.date);
        if (Number.isNaN(date.getTime())) throw new BadRequest("Invalid date.");
        doc.date = date;
      }
      if (payload.expected_date !== undefined) {
        if (payload.expected_date) {
          const ed = new Date(payload.expected_date);
          if (Number.isNaN(ed.getTime())) {
            throw new BadRequest("Invalid expected date.");
          }
          doc.expected_date = ed;
        } else {
          doc.expected_date = null;
        }
      }
      if (payload.reference !== undefined) {
        doc.reference = String(payload.reference).trim();
      }
      if (payload.description !== undefined) {
        doc.description = String(payload.description).trim();
      }

      if (payload.pr_ids !== undefined) {
        await validatePurchaseRequests({ prIds: payload.pr_ids, session });
      }

      // Tautan PR (array purchase_order_id) & status PR di-recompute otomatis
      // dari item lewat syncParentStatuses — tidak lagi di-set manual di sini.
      let affectedPrIds = [];
      if (payload.items !== undefined) {
        const sync = await syncPurchaseOrderItems({
          poId: doc._id,
          payloadItems: payload.items,
          session,
        });
        doc.total_amount = sync.total;
        doc.pr_ids = sync.linkedPrIds;
        affectedPrIds = sync.affectedPrIds;
      }

      if (payload.status !== undefined) {
        const s = String(payload.status).toUpperCase();
        if (!STATUSES.includes(s)) throw new BadRequest("Invalid status.");
        doc.status = s;
      }

      await doc.save({ session });

      // Recompute status + array PO pada PR yang tersentuh.
      await syncParentStatuses({ prIds: affectedPrIds, session });

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

      return doc;
    });

    res.status(200).json({
      code: 200,
      success: true,
      message: "Purchase order updated successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.delete = async (req, res, next) => {
  /*
    #swagger.tags = ['Purchase Order']
    #swagger.summary = 'Delete Purchase Order (soft delete)'
    #swagger.description = 'Soft delete a purchase order; rejected if already submitted.'
    #swagger.parameters['id'] = { description: 'purchase order id' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await PurchaseOrderModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new BadRequest("Data not found!");
      // Tak bisa dihapus bila barang sudah mulai diterima (GR).
      if (["PARTIAL_RECEIVED", "RECEIVED", "CLOSED"].includes(doc.status)) {
        throw new BadRequest(
          "Purchase order already has received goods and cannot be deleted.",
        );
      }

      const before = doc.toObject();

      // PR yang tersentuh (untuk recompute status setelah item dikembalikan).
      const poItems = await DetailProductItemModel.find({
        purchase_order_id: doc._id,
      }).session(session);
      const affectedPrIds = [
        ...new Set(
          poItems
            .filter((d) => d.purchase_request_id)
            .map((d) => String(d.purchase_request_id)),
        ),
      ];

      doc.is_delete = true;
      await doc.save({ session });

      // Item milik PR dikembalikan ke awal: lepas PO, status PENDING, supplier
      // null — sehingga masih bisa dibuatkan PO lagi. Item manual milik PO saja
      // dihapus.
      await DetailProductItemModel.updateMany(
        { purchase_order_id: doc._id, purchase_request_id: { $ne: null } },
        {
          $set: {
            purchase_order_id: null,
            status: "PENDING",
            supplier_id: null,
          },
        },
      ).session(session);
      await DetailProductItemModel.deleteMany({
        purchase_order_id: doc._id,
        purchase_request_id: null,
      }).session(session);

      // Recompute status PR: PARTIAL_ORDERED bila sebagian item masih di PO lain,
      // atau SUBMITTED bila semua item kembali PENDING.
      await syncParentStatuses({ prIds: affectedPrIds, session });

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
      message: "Purchase order deleted successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = controller;
