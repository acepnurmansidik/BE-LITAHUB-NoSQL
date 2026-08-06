const { runWithOptionalTransaction } = require("../../helper/crudService");
const { generateSequenceNo } = require("../../helper/sequence");
const { syncPurchaseOrderItems } = require("../../helper/DetailProductItems");
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

// Validasi daftar PR yang akan ditautkan ke PO ini. Tiap PR harus ada,
// ber-status SUBMITTED, dan belum ditautkan ke PO lain (kecuali PO ini
// sendiri saat update). Mengembalikan daftar id unik (string).
const validatePurchaseRequests = async ({ prIds, session, currentPoId }) => {
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
    if (pr.status !== "SUBMITTED") {
      throw new BadRequest(`PR ${pr.request_no} is not submitted yet.`);
    }
    const linked = pr.purchase_order_id ? String(pr.purchase_order_id) : null;
    if (linked && linked !== String(currentPoId ?? "")) {
      throw new BadRequest(
        `PR ${pr.request_no} is already linked to another purchase order.`,
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
          ],
        })
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
        ],
      })
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

    const result = await runWithOptionalTransaction(async (session) => {
      const prIds = await validatePurchaseRequests({
        prIds: payload.pr_ids,
        session,
        currentPoId: null,
      });

      const order_no = await generateSequenceNo({
        module: MODULE_NAME,
        prefix: "PO",
        date,
        session,
      });

      const [doc] = await PurchaseOrderModel.create(
        [
          {
            order_no,
            date,
            expected_date: expectedDate,
            reference: String(payload.reference ?? "").trim(),
            description: String(payload.description ?? "").trim(),
            pr_ids: prIds,
            total_amount: 0,
          },
        ],
        { session },
      );

      // Item: reuse detail PR (shared doc) + item manual. Menghitung total.
      const { total } = await syncPurchaseOrderItems({
        poId: doc._id,
        payloadItems: payload.items,
        session,
      });

      doc.total_amount = total;
      await doc.save({ session });

      // Tandai PR sumber sebagai "sudah dibuatkan PO".
      if (prIds.length) {
        await PurchaseRequestModel.updateMany(
          { _id: { $in: prIds } },
          { purchase_order_id: doc._id },
        ).session(session);
      }

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

      return doc;
    });

    res.status(201).json({
      code: 201,
      success: true,
      message: "Purchase order created successfully!",
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
      if (doc.status === "SUBMITTED") {
        throw new BadRequest("Submitted purchase order is locked.");
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

      // Rekonsiliasi tautan PR: lepas flag lama milik PO ini, pasang yang baru.
      if (payload.pr_ids !== undefined) {
        const newIds = await validatePurchaseRequests({
          prIds: payload.pr_ids,
          session,
          currentPoId: id,
        });
        await PurchaseRequestModel.updateMany(
          { purchase_order_id: id },
          { purchase_order_id: null },
        ).session(session);
        if (newIds.length) {
          await PurchaseRequestModel.updateMany(
            { _id: { $in: newIds } },
            { purchase_order_id: id },
          ).session(session);
        }
        doc.pr_ids = newIds;
      }

      if (payload.items !== undefined) {
        const { total } = await syncPurchaseOrderItems({
          poId: doc._id,
          payloadItems: payload.items,
          session,
        });
        doc.total_amount = total;
      }

      if (payload.status !== undefined) {
        const s = String(payload.status).toUpperCase();
        if (!STATUSES.includes(s)) throw new BadRequest("Invalid status.");
        doc.status = s;
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
      if (doc.status === "SUBMITTED") {
        throw new BadRequest("Submitted purchase order cannot be deleted.");
      }

      const before = doc.toObject();
      doc.is_delete = true;
      await doc.save({ session });

      // Lepas flag pada PR sumber.
      await PurchaseRequestModel.updateMany(
        { purchase_order_id: id },
        { purchase_order_id: null },
      ).session(session);

      // Item dari PR di-detach (kembali jadi milik PR saja); item manual milik
      // PO dihapus.
      await DetailProductItemModel.updateMany(
        { purchase_order_id: doc._id, purchase_request_id: { $ne: null } },
        { purchase_order_id: null },
      ).session(session);
      await DetailProductItemModel.deleteMany({
        purchase_order_id: doc._id,
        purchase_request_id: null,
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
      message: "Purchase order deleted successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = controller;
