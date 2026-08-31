const { runWithOptionalTransaction } = require("../../helper/crudService");
const NotFound = require("../../utils/errors/not-found");
const LogActionModel = require("../models/LogAction.model");
const VehicleRateModel = require("../models/VehicleRate.model");

const controller = {};
const source = VehicleRateModel.collection.collectionName;

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['Vehicle Rate']
    #swagger.summary = 'List Vehicle Rate'
    #swagger.description = 'Retrieve a paginated list of Vehicle Rate with their access modules and path access.'
    #swagger.parameters['search'] = { default: '', description: 'search by value' }
    #swagger.parameters['limit'] = { default: 10, description: 'limit' }
    #swagger.parameters['page'] = { default: 1, description: 'page' }
  */
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { search } = req.query;

    const query = { is_delete: { $ne: true } };
    if (search) {
      query["$or"] = [{ name: { $regex: search, $options: "i" } }];
    }

    const populateField = [
      {
        path: "created_by",
        model: "User",
      },
    ];

    const [data, total] = await Promise.all([
      VehicleRateModel.find(query)
        .populate(populateField)
        .sort({ _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      VehicleRateModel.countDocuments(query),
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
    #swagger.tags = ['Vehicle Rate']
    #swagger.summary = 'Get Vehicle Rate detail'
    #swagger.parameters['id'] = { description: 'id vehicle rate' }
  */
  try {
    const { id } = req.params;
    // check data on database
    const data = await VehicleRateModel.findOne({
      _id: id,
      is_delete: { $ne: true },
    });
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
    #swagger.tags = ['Vehicle Rate']
    #swagger.summary = 'Create Vehicle Rate'
    #swagger.description = 'Create a new vehicle rate.'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create vehicle rate',
      schema: { $ref: '#/definitions/BodyVehicleRateSchema' }
    }
  */
  try {
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const [data] = await VehicleRateModel.create([payload], { session });

      await LogActionModel.create(
        [
          {
            target_id: data._id,
            source,
            activities: [
              {
                type: "CREATE",
                after: data.toObject(),
                created_by: req?.login?.user_id ?? null,
              },
            ],
          },
        ],
        { session },
      );

      return data;
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
    #swagger.tags = ['Vehicle Rate']
    #swagger.summary = 'Update Vehicle Rate'
    #swagger.description = 'Update an existing Vehicle Rate.'
    #swagger.parameters['id'] = { description: 'id vehicle rate' }
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Update Vehicle Rate',
      schema: { $ref: '#/definitions/BodyVehicleRateSchema' }
    }
  */
  try {
    const payload = req.body;
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      // check data on database
      const doc = await VehicleRateModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      });
      if (!doc) throw new NotFound(`Data with id '${id}' not found`);

      const before = doc.toObject();

      doc.set(payload);
      await doc.save({ session });

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source,
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
    res.status(201).json({
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
    #swagger.tags = ['Vehicle Rate']
    #swagger.summary = 'Update Vehicle Rate'
    #swagger.description = 'Update an existing Vehicle Rate.'
    #swagger.parameters['id'] = { description: 'id vehicle rate' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await VehicleRateModel.findOne({ _id: id });
      if (!doc) throw new NotFound(`Data with id '${id} not found'`);

      const before = doc.toObject();
      doc.is_delete = true;
      await doc.save({ session });

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: VehicleRateModel.collection.collectionName,
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

    res
      .status(200)
      .json({ success: true, message: "Data has been deleted", data: result });
  } catch (error) {
    next(error);
  }
};

module.exports = controller;
