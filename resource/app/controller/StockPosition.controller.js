const { runWithOptionalTransaction } = require("../../helper/crudService");
const BadRequest = require("../../utils/errors/bad-request");
const NotFound = require("../../utils/errors/not-found");
const StockPositionModel = require("../models/StockPosition.model");
const LogActionModel = require("../models/LogAction.model");

const controller = {};

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['Stock Position']
    #swagger.summary = 'List Stock Positions'
    #swagger.description = 'Retrieve a paginated list of stock positions with optional product and warehouse filters.'
    #swagger.parameters['page'] = { default: 1 }
    #swagger.parameters['limit'] = { default: 10 }
    #swagger.parameters['product_id'] = { default: '' }
    #swagger.parameters['warehouse_id'] = { default: '' }
  */
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { product_id, warehouse_id } = req.query;

    const query = { is_delete: { $ne: true } };
    if (product_id) query.product_id = product_id;
    if (warehouse_id) query.warehouse_id = warehouse_id;

    const [data, total] = await Promise.all([
      StockPositionModel.find(query)
        .populate("product_id", "name code")
        .populate("warehouse_id", "name code")
        .populate("uom_id", "name code")
        .sort({ _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      StockPositionModel.countDocuments(query),
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
    #swagger.tags = ['Stock Position']
    #swagger.summary = 'Get Stock Position detail'
    #swagger.parameters['id'] = { description: 'id stock position' }
  */
  try {
    const { id } = req.params;
    const data = await StockPositionModel.findOne({
      _id: id,
      is_delete: { $ne: true },
    })
      .populate("product_id", "name code")
      .populate("warehouse_id", "name code")
      .populate("uom_id", "name code");
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
    #swagger.tags = ['Stock Position']
    #swagger.summary = 'Create Stock Position'
    #swagger.description = 'Create a new stock position for a product in a warehouse.'
    #swagger.parameters['obj'] = {
      in: 'body', description: 'Create stock position',
      schema: { $ref: '#/definitions/BodyStockPositionSchema' }
    }
  */
  try {
    const payload = req.body;
    if (!payload?.product_id) throw new BadRequest("product_id is required.");
    if (!payload?.warehouse_id)
      throw new BadRequest("warehouse_id is required.");

    const result = await runWithOptionalTransaction(async (session) => {
      const [stock] = await StockPositionModel.create(
        [
          {
            product_id: payload.product_id,
            warehouse_id: payload.warehouse_id,
            uom_id: payload.uom_id ?? null,
            quantity: payload.quantity,
            reserved_quantity: payload.reserved_quantity,
          },
        ],
        { session },
      );

      await LogActionModel.create(
        [
          {
            target_id: stock._id,
            source: StockPositionModel.collection.collectionName,
            activities: [
              {
                type: "CREATE",
                after: stock.toObject(),
                created_by: req?.login?.user_id ?? null,
              },
            ],
          },
        ],
        { session },
      );

      return stock;
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
    #swagger.tags = ['Stock Position']
    #swagger.summary = 'Update Stock Position'
    #swagger.description = 'Update an existing stock position.'
    #swagger.parameters['id'] = { description: 'id stock position' }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await StockPositionModel.findOne({
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
            source: StockPositionModel.collection.collectionName,
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
    #swagger.tags = ['Stock Position']
    #swagger.summary = 'Delete Stock Position (soft delete)'
    #swagger.parameters['id'] = { description: 'id stock position' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await StockPositionModel.findOne({
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
            source: StockPositionModel.collection.collectionName,
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
