const { runWithOptionalTransaction } = require("../../helper/crudService");
const BadRequest = require("../../utils/errors/bad-request");
const NotFound = require("../../utils/errors/not-found");
const LogActionModel = require("../models/LogAction.model");
const UnitModel = require("../models/Unit.model");
const VehicleRateModel = require("../models/VehicleRate.model");
const VehicleModel = require("../models/Vehicle.model");

const controller = {};
const source = VehicleModel.collection.collectionName;

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['Vehicle Utility']
    #swagger.summary = 'List Vehicle Utility'
    #swagger.description = 'Retrieve a paginated list of Vehicle Utility with their access modules and path access.'
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
      query["$or"] = [
        { vin: { $regex: search, $options: "i" } },
        { unit_name: { $regex: search, $options: "i" } },
        { vehicle_type: { $regex: search, $options: "i" } },
      ];
    }

    const populateField = [
      {
        path: "rate_id",
        model: "VehicleRate",
        select: "_id name rate",
      },
    ];

    const [data, total] = await Promise.all([
      VehicleModel.find(query)
        .populate(populateField)
        .sort({ _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      VehicleModel.countDocuments(query),
    ]);

    res.status(200).json({
      status: 200,
      message: "Data retrieved successfully",
      data,
      page_size: total,
      current_page: page,
    });
  } catch (error) {
    next(next);
  }
};

controller.show = async (req, res, next) => {
  /*
    #swagger.tags = ['Vehicle Utility']
    #swagger.summary = 'Get Vehicle Utility'
    #swagger.parameters['id'] = { description: 'id vehicle Utility' }
  */
  try {
    const { id } = req.params;

    const data = await VehicleModel.findOne({
      _id: id,
      is_delete: { $ne: true },
    });
    if (!data) throw new NotFound(`data with id '${id} not found!'`);

    res
      .status(200)
      .json({ success: true, message: "Data retrieved successfully!", data });
  } catch (error) {
    next(error);
  }
};

controller.create = async (req, res, next) => {
  /*
    #swagger.tags = ['Vehicle Utility']
    #swagger.summary = 'Create Vehicle Utility'
    #swagger.description = 'Create an existing Vehicle Utility.'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create Vehicle Utility',
      schema: { $ref: '#/definitions/BodyVehicleUtilitySchema' }
    }
  */
  try {
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const [docVin, unit, rate] = await Promise.all([
        VehicleModel.findOne({
          vin: { $regex: payload.vin, $options: "i" },
          is_delete: { $ne: true },
        }),
        UnitModel.findOne({ _id: payload.unit_id, is_delete: { $ne: true } }),
        VehicleRateModel.findOne({
          _id: payload.rate_id,
          is_delete: { $ne: true },
        }),
      ]);

      if (docVin) throw new BadRequest(`Vehicle identifier has been register!`);
      if (!unit)
        throw new NotFound(`data unit '${payload.unit_name}' not found`);
      if (!rate)
        throw new NotFound(`data with id '${payload.rate_id}' not found`);

      const [data] = await VehicleModel.create([payload], { session });
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

    res
      .status(201)
      .json({ success: true, message: "Data has been created!", data: result });
  } catch (error) {
    next(error);
  }
};

controller.update = async (req, res, next) => {
  /*
    #swagger.tags = ['Vehicle Utility']
    #swagger.summary = 'Update Vehicle Utility'
    #swagger.description = 'Update an existing Vehicle Utility.'
    #swagger.parameters['id'] = { description: 'id vehicle Utility' }
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Update Vehicle Utility',
      schema: { $ref: '#/definitions/BodyVehicleUtilitySchema' }
    }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const [doc, vinExist, unit, rate] = await Promise.all([
        VehicleModel.findOne({ _id: id, is_delete: { $ne: true } }),
        VehicleModel.findOne({
          vin: { $regex: payload.vin, $options: "i" },
          unit_id: { $ne: payload.unit_id },
          is_delete: { $ne: true },
        }),
        UnitModel.findOne({ _id: payload.unit_id, is_delete: { $ne: true } }),
        VehicleRateModel.findOne({
          _id: payload.rate_id,
          is_delete: { $ne: true },
        }),
      ]);

      if (!doc) throw new NotFound(`Data with id '${id}' not found`);
      if (vinExist)
        throw new BadRequest(`Vehicle identifier has been register!`);
      if (!unit)
        throw new NotFound(`Data unit '${payload.unit_name}' not found`);
      if (!rate)
        throw new NotFound(`data with id '${payload.rate_id}' not found`);

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

    res
      .status(201)
      .json({ success: true, message: "Data has been update", data: result });
  } catch (error) {
    next(error);
  }
};

controller.delete = async (req, res, next) => {
  /*
    #swagger.tags = ['Vehicle Utility']
    #swagger.summary = 'Update Vehicle Utility'
    #swagger.description = 'Update an existing Vehicle Utility.'
    #swagger.parameters['id'] = { description: 'id vehicle Utility' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await VehicleModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      });

      if (!doc) throw new NotFound(`Data with id '${id}' not found`);
      const before = doc.toObject();

      doc.is_delete = true;
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
      .json({ success: true, message: "Data has been deleted!", data: result });
  } catch (error) {
    next(error);
  }
};

module.exports = controller;
