const { runWithOptionalTransaction } = require("../../helper/crudService");
const BadRequest = require("../../utils/errors/bad-request");
const NotFound = require("../../utils/errors/not-found");
const StockMovementModel = require("../models/StockMovement.model");
const LogActionModel = require("../models/LogAction.model");

const controller = {};

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['Stock Movement']
    #swagger.summary = 'List stock movements'
    #swagger.parameters['page'] = { default: 1 }
    #swagger.parameters['limit'] = { default: 10 }
    #swagger.parameters['product_id'] = { default: '' }
    #swagger.parameters['warehouse_id'] = { default: '' }
    #swagger.parameters['type'] = { default: '', description: 'IN | OUT | ADJUSTMENT | TRANSFER' }
  */
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { product_id, warehouse_id, type } = req.query;

    const query = { is_delete: { $ne: true } };
    if (product_id) query.product_id = product_id;
    if (warehouse_id) query.warehouse_id = warehouse_id;
    if (type) query.type = type;

    const [data, total] = await Promise.all([
      StockMovementModel.find(query)
        .populate("product_id", "name code")
        .populate("warehouse_id", "name code")
        .sort({ date: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      StockMovementModel.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: total,
      current_page: page,
    });
  } catch (error) {
    next(error);
  }
};

controller.show = async (req, res, next) => {
  /*
    #swagger.tags = ['Stock Movement']
    #swagger.summary = 'Detail stock movement'
    #swagger.parameters['id'] = { description: 'id stock movement' }
  */
  try {
    const { id } = req.params;
    const data = await StockMovementModel.findOne({
      _id: id,
      is_delete: { $ne: true },
    })
      .populate("product_id", "name code")
      .populate("warehouse_id", "name code");
    if (!data) throw new NotFound(`Data with id '${id}' not found!`);

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
    });
  } catch (error) {
    next(error);
  }
};

controller.create = async (req, res, next) => {
  /*
    #swagger.tags = ['Stock Movement']
    #swagger.summary = 'Create stock movement'
    #swagger.parameters['obj'] = {
      in: 'body', description: 'Create stock movement',
      schema: { $ref: '#/definitions/BodyStockMovementSchema' }
    }
  */
  try {
    const payload = req.body;
    if (!payload?.product_id) throw new BadRequest("product_id is required.");
    if (!payload?.warehouse_id)
      throw new BadRequest("warehouse_id is required.");
    if (!payload?.type) throw new BadRequest("type is required.");
    if (payload?.quantity === undefined || payload?.quantity === null)
      throw new BadRequest("quantity is required.");

    const result = await runWithOptionalTransaction(async (session) => {
      const [movement] = await StockMovementModel.create(
        [
          {
            product_id: payload.product_id,
            warehouse_id: payload.warehouse_id,
            destination_warehouse_id: payload.destination_warehouse_id ?? null,
            uom_id: payload.uom_id ?? null,
            type: payload.type,
            quantity: payload.quantity,
            reference: payload.reference,
            date: payload.date,
            note: payload.note,
          },
        ],
        { session },
      );

      await LogActionModel.create(
        [
          {
            target_id: movement._id,
            source: StockMovementModel.collection.collectionName,
            activities: [
              {
                type: "CREATE",
                after: movement.toObject(),
                created_by: req?.login?.user_id ?? null,
              },
            ],
          },
        ],
        { session },
      );

      return movement;
    });

    res.status(201).json({
      success: true,
      message: "Data has been created!",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

controller.update = async (req, res, next) => {
  /*
    #swagger.tags = ['Stock Movement']
    #swagger.summary = 'Update stock movement'
    #swagger.parameters['id'] = { description: 'id stock movement' }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await StockMovementModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new NotFound(`Data with id '${id}' not found!`);

      const before = doc.toObject();
      doc.set(payload);
      await doc.save({ session });

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: StockMovementModel.collection.collectionName,
          },
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
      success: true,
      message: "Data has been updated!",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

controller.delete = async (req, res, next) => {
  /*
    #swagger.tags = ['Stock Movement']
    #swagger.summary = 'Delete stock movement (soft delete)'
    #swagger.parameters['id'] = { description: 'id stock movement' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await StockMovementModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new NotFound(`Data with id '${id}' not found!`);

      const before = doc.toObject();
      doc.is_delete = true;
      await doc.save({ session });

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: StockMovementModel.collection.collectionName,
          },
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
      success: true,
      message: "Data has been deleted!",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = controller;
