const { generateShortCode } = require("../../helper/codeGenerator");
const { runWithOptionalTransaction } = require("../../helper/crudService");
const globalService = require("../../helper/global-func");
const BadRequest = require("../../utils/errors/bad-request");
const NotFound = require("../../utils/errors/not-found");
const BranchModel = require("../models/Branch.model");
const LogActionModel = require("../models/LogAction.model");

const controller = {};

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['Branch']
    #swagger.summary = 'List Branches'
    #swagger.description = 'Retrieve a paginated list of branches with optional search by name or code.'
    #swagger.parameters['page'] = { default: 1 }
    #swagger.parameters['limit'] = { default: 10 }
    #swagger.parameters['search'] = { default: '', description: 'name / code' }
  */
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { search } = req.query;

    const query = { is_delete: { $ne: true } };
    if (search) {
      query["$or"] = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
      ];
    }

    const [data, total] = await Promise.all([
      BranchModel.find(query)
        .sort({ _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      BranchModel.countDocuments(query),
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
    #swagger.tags = ['Branch']
    #swagger.summary = 'Get Branch detail'
    #swagger.description = 'Retrieve the details of a single branch by its ID.'
    #swagger.parameters['id'] = { description: 'branch id' }
  */
  try {
    const { id } = req.params;
    const data = await BranchModel.findOne({
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
    #swagger.tags = ['Branch']
    #swagger.summary = 'Create Branch'
    #swagger.description = 'Create a branch with code and slug auto-generated from the name.'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create branch',
      schema: { $ref: '#/definitions/BodyBranchSchema' }
    }
  */
  try {
    const payload = req.body;
    if (!payload?.name) throw new BadRequest("Branch name is required.");

    const result = await runWithOptionalTransaction(async (session) => {
      const [data] = await BranchModel.create([payload], { session });
      await LogActionModel.create(
        [
          {
            target_id: data._id,
            source: BranchModel.collection.collectionName,
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
    #swagger.tags = ['Branch']
    #swagger.summary = 'Update Branch'
    #swagger.description = 'Update an existing branch identified by its ID.'
    #swagger.parameters['id'] = { description: 'branch id' }
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Update branch',
      schema: { $ref: '#/definitions/BodyBranchSchema' }
    }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await BranchModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new NotFound(`Data with id '${id}' not found!`);

      const before = doc.toObject();

      // Kode & slug bersifat stabil setelah dibuat — jangan ditimpa dari body.
      payload.code = await generateShortCode(payload.name);
      payload.slug = globalService.createSlug(payload.name);

      doc.set(payload);
      await doc.save({ session });

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: BranchModel.collection.collectionName,
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
    #swagger.tags = ['Branch']
    #swagger.summary = 'Delete Branch (soft delete)'
    #swagger.description = 'Soft-delete a branch by marking it as deleted without removing the record.'
    #swagger.parameters['id'] = { description: 'branch id' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await BranchModel.findOne({
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
            source: BranchModel.collection.collectionName,
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
