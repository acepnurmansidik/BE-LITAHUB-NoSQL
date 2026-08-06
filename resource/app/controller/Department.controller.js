const { runWithOptionalTransaction } = require("../../helper/crudService");
const globalService = require("../../helper/global-func");
const BadRequest = require("../../utils/errors/bad-request");
const NotFound = require("../../utils/errors/not-found");
const DepartmentModel = require("../models/Department.model");
const LogActionModel = require("../models/LogAction.model");
const UsersModel = require("../models/users.model");

const controller = {};

const MODULE_NAME = DepartmentModel.collection.collectionName;

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['Department']
    #swagger.summary = 'List Departments'
    #swagger.parameters['page'] = { default: 1 }
    #swagger.parameters['limit'] = { default: 10 }
    #swagger.parameters['search'] = { default: '', description: 'name / code' }
  */
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 1, 1);
    const query = {};
    const { search } = req.query;
    if (search) {
      query["$or"] = [{ name: { $regex: search, $options: "i" } }];
    }

    const [data, total] = await Promise.all([
      DepartmentModel.find(query)
        .populate("head_of_department_id", "_id name")
        .sort({ _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      DepartmentModel.countDocuments(query),
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
    #swagger.tags = ['Department']
    #swagger.summary = 'Get Department detail'
    #swagger.parameters['id'] = { description: 'id Department' }
  */
  try {
    const { id } = req.params;
    const data = await DepartmentModel.findOne({
      _id: id,
      is_delete: { $ne: true },
    })
      .populate("head_of_department_id", "_id name")
      .lean();
    if (!data) throw new NotFound(`Data with id: ${id} not found!`);

    res
      .status(200)
      .json({ success: true, message: "Data retrieved successfully!", data });
  } catch (error) {
    next(error);
  }
};

controller.create = async (req, res, next) => {
  /*
    #swagger.tags = ['Department']
    #swagger.summary = 'Create Department'
    #swagger.description = 'Create a new department; code is auto-generated from the name.'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create Department',
      schema: { $ref: '#/definitions/BodyDepartmentSchema' }
    }
  */
  try {
    const payload = req.body;
    payload.slug = globalService.createSlug(payload.name);

    const result = await runWithOptionalTransaction(async (session) => {
      if (payload.head_of_department_id) {
        const user = await UsersModel.findOne({
          _id: payload.head_of_department_id,
        });

        if (!user)
          throw new NotFound(
            `Data user as head department with id: '${payload.head_of_department_id}' not found!`,
          );
      }

      const [doc] = await DepartmentModel.create([payload], { session });

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

    res
      .status(200)
      .json({ success: true, message: "Data has been created!", data: result });
  } catch (error) {
    next(error);
  }
};

controller.update = async (req, res, next) => {
  /*
    #swagger.tags = ['Department']
    #swagger.summary = 'Update Department'
    #swagger.parameters['id'] = { description: 'id Department' }
    #swagger.description = 'Update an existing department.'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Update Department',
      schema: { $ref: '#/definitions/BodyDepartmentSchema' }
    }
  */
  try {
    const { id } = req.params;
    const payload = req.body;
    payload.slug = globalService.createSlug(payload.name);

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await DepartmentModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      });
      if (!doc) throw new NotFound(`Data with id: '${id}' not found!`);
      const before = doc.toObject();

      if (payload.head_of_department_id !== undefined) {
        const user = await UsersModel.findOne({
          _id: payload.head_of_department_id,
        });
        if (!user)
          throw new BadRequest(
            `Data user as head department with id: '${payload.head_of_department_id}' not found!`,
          );
      }

      doc.set(payload);
      await doc.save({ session });

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: MODULE_NAME,
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
      .status(200)
      .json({ success: true, message: "Data has been updated!", data: result });
  } catch (error) {
    next(error);
  }
};

controller.delete = async (req, res, next) => {
  /*
    #swagger.tags = ['Department']
    #swagger.summary = 'Delete Department (soft delete)'
    #swagger.parameters['id'] = { description: 'id Department' }
  */
  try {
    const { id } = req.params;
    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await DepartmentModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      });
      if (!doc) throw new NotFound(`Data with id: ${id} not found!`);

      const before = doc.toObject();

      doc.is_delete = true;
      doc.save({ session });

      await LogActionModel.findOneAndUpdate(
        { target_id },
        {
          $setOnInsert: {
            target_id: id,
            source: MODULE_NAME,
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
    });

    res
      .status(201)
      .json({ success: true, message: "Data has been deleted!", data: result });
  } catch (error) {
    next(error);
  }
};

module.exports = controller;
