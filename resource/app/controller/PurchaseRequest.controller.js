const { runWithOptionalTransaction } = require("../../helper/crudService");
const { generateSequenceNo } = require("../../helper/sequence");
const {
  buildDetailProductItems,
  syncDetailProductItems,
} = require("../../helper/DetailProductItems");
const BadRequest = require("../../utils/errors/bad-request");
const LogActionModel = require("../models/LogAction.model");
const PurchaseRequestModel = require("../models/PurchaseRequest.model");
const DetailProductItemModel = require("../models/DetailProductItem.model");

const controller = {};
const STATUSES = ["DRAFT", "SUBMITTED"];
const MODULE_NAME = PurchaseRequestModel.collection.collectionName;

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['PURCHASE REQUEST']
    #swagger.summary = 'Purchase Request'
    #swagger.parameters['page'] = { default: 1 }
    #swagger.parameters['limit'] = { default: 10 }
    #swagger.parameters['search'] = { default: '', description: 'request_no / reference / description' }
    #swagger.parameters['status'] = { default: '', description: 'DRAFT | SUBMITTED' }
  */
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { search, status } = req.query;

    const baseQuery = { is_delete: { $ne: true } };
    if (search) {
      baseQuery["$or"] = [
        { request_no: { $regex: search, $options: "i" } },
        { reference: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }
    const query = { ...baseQuery };
    if (status && STATUSES.includes(String(status).toUpperCase())) {
      query.status = String(status).toUpperCase();
    }

    const [data, total, counts] = await Promise.all([
      PurchaseRequestModel.find(query)
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
      PurchaseRequestModel.countDocuments(query),
      PurchaseRequestModel.aggregate([
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
    #swagger.tags = ['PURCHASE REQUEST']
    #swagger.parameters['id'] = { description: 'id purchase request' }
  */
  try {
    const data = await PurchaseRequestModel.findOne({
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
    #swagger.tags = ['PURCHASE REQUEST']
    #swagger.summary = 'Buat purchase request baru (default DRAFT)'
  */
  try {
    const payload = req.body;
    const date = payload.date ? new Date(payload.date) : new Date();
    if (Number.isNaN(date.getTime())) throw new BadRequest("Invalid date.");
    let neededDate = null;
    if (payload.needed_date) {
      neededDate = new Date(payload.needed_date);
      if (Number.isNaN(neededDate.getTime())) {
        throw new BadRequest("Invalid needed date.");
      }
    }

    const result = await runWithOptionalTransaction(async (session) => {
      // PR tidak boleh memuat produk yang sama dua kali.
      const { items, total } = await buildDetailProductItems(
        payload.items,
        session,
        { noDuplicate: true },
      );
      const request_no = await generateSequenceNo({
        module: MODULE_NAME,
        prefix: "PR",
        date,
        session,
      });

      const [doc] = await PurchaseRequestModel.create(
        [
          {
            request_no,
            date,
            needed_date: neededDate,
            requested_by: String(payload.requested_by ?? "").trim(),
            reference: String(payload.reference ?? "").trim(),
            description: String(payload.description ?? "").trim(),
            total_amount: total,
          },
        ],
        { session },
      );

      await syncDetailProductItems({
        parentField: "purchase_request_id",
        parentId: doc._id,
        items,
        session,
      });

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
      message: "Purchase request created successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.update = async (req, res, next) => {
  /*
    #swagger.tags = ['PURCHASE REQUEST']
    #swagger.summary = 'Perbarui PR / submit (status DRAFT->SUBMITTED)'
    #swagger.parameters['id'] = { description: 'id purchase request' }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await PurchaseRequestModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new BadRequest("Data not found!");
      // Dikunci setelah SUBMITTED (tidak bisa diedit lagi).
      if (doc.status === "SUBMITTED") {
        throw new BadRequest("Submitted purchase request is locked.");
      }

      const before = doc.toObject();

      delete doc.requested_by;

      if (payload.date !== undefined) {
        const date = new Date(payload.date);
        if (Number.isNaN(date.getTime())) throw new BadRequest("Invalid date.");
        doc.date = date;
      }
      if (payload.needed_date !== undefined) {
        if (payload.needed_date) {
          const nd = new Date(payload.needed_date);
          if (Number.isNaN(nd.getTime())) {
            throw new BadRequest("Invalid needed date.");
          }
          doc.needed_date = nd;
        } else {
          doc.needed_date = null;
        }
      }
      if (payload.reference !== undefined) {
        doc.reference = String(payload.reference).trim();
      }
      if (payload.description !== undefined) {
        doc.description = String(payload.description).trim();
      }
      if (payload.items !== undefined) {
        const { items, total } = await buildDetailProductItems(
          payload.items,
          session,
          { noDuplicate: true },
        );
        await syncDetailProductItems({
          parentField: "purchase_request_id",
          parentId: doc._id,
          items,
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
      message: "Purchase request updated successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.delete = async (req, res, next) => {
  /*
    #swagger.tags = ['PURCHASE REQUEST']
    #swagger.summary = 'Hapus PR (soft delete). Ditolak bila sudah SUBMITTED / sudah dibuatkan PO.'
    #swagger.parameters['id'] = { description: 'id purchase request' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await PurchaseRequestModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new BadRequest("Data not found!");
      if (doc.status === "SUBMITTED") {
        throw new BadRequest("Submitted purchase request cannot be deleted.");
      }
      if (doc.purchase_order_id) {
        throw new BadRequest(
          "Cannot delete: this request is already linked to a purchase order.",
        );
      }

      const before = doc.toObject();
      doc.is_delete = true;
      await doc.save({ session });
      // Buang item detailnya.
      await DetailProductItemModel.deleteMany({
        purchase_request_id: doc._id,
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
      message: "Purchase request deleted successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = controller;
