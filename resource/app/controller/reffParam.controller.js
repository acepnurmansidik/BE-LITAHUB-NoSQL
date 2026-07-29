const ReffparamModel = require("../models/ReffParam.model");
const crudServices = require("../../helper/crudService");
const globalService = require("../../helper/global-func");
const BadRequest = require("../../utils/errors/bad-request");

const controller = {};

controller.uploadImage = async (req, res, next) => {
  /*
    #swagger.tags = ['REF PARAMETER']
    #swagger.summary = 'Upload ref parameter icon (stored in Image model)'
    #swagger.consumes = ['multipart/form-data']
    #swagger.parameters['proofs'] = {
      in: 'formData', type: 'array', required: true,
      collectionFormat: 'multi', items: { type: 'file' }
    }
  */
  try {
    const files = req?.files?.proofs;
    if (!files || files.length === 0) {
      throw new BadRequest("No image uploaded. Use form field 'proofs'.");
    }
    const fileResult = await globalService.uploadFiles(files);
    const data = fileResult.map((item) => ({ _id: item.id, path: item.path }));
    res.status(200).json({
      success: true,
      message: "Image uploaded successfully!",
      data,
    });
  } catch (err) {
    next(err);
  }
};

controller.index = async (req, res, next) => {
  const query = { is_delete: { $ne: true } };
  const { search, type, page, limit = 10 } = req.query;
  const skip = (page - 1) * limit;

  if (type) query.type = type;

  const arrFilter = [];
  if (search) {
    arrFilter.push({ value: { $regex: search, $options: "i" } });
    arrFilter.push({ description: { $regex: search, $options: "i" } });
  }
  if (arrFilter.length) query["$or"] = arrFilter;

  const populateField = [
    { path: "icon_id", model: "Image", select: "_id path" },
  ];
  try {
    /*
    #swagger.tags = ['REF PARAMETER']
    #swagger.summary = 'ref parameter'
    #swagger.description = 'untuk referensi group'
    #swagger.parameters['search'] = { default: '', description: 'search by value / description' }
    #swagger.parameters['type'] = { default: '', description: 'filter by type' }
    #swagger.parameters['limit'] = { default: 10, description: 'limit' }
    #swagger.parameters['page'] = { default: 1, description: 'page' }
  */
    const [page_size, result] = await Promise.all([
      ReffparamModel.countDocuments(query),
      crudServices.findAllPagination(ReffparamModel, {
        query,
        populateField,
        skip,
        limit,
      }),
    ]);

    res.status(200).json({ ...result, page_size, current_page: Number(page) });
  } catch (err) {
    next(err);
  }
};

controller.types = async (req, res, next) => {
  /*
    #swagger.tags = ['REF PARAMETER']
    #swagger.summary = 'Distinct ref parameter types'
    #swagger.description = 'Daftar type unik untuk filter grouping.'
  */
  try {
    const types = await ReffparamModel.distinct("type", {
      is_delete: { $ne: true },
    });
    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data: types.sort(),
    });
  } catch (err) {
    next(err);
  }
};

controller.create = async (req, res, next) => {
  try {
    /*
    #swagger.tags = ['REF PARAMETER']
    #swagger.summary = 'ref parameter'
    #swagger.description = 'untuk referensi group'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create role',
      schema: { $ref: '#/definitions/BodyRefParameterSchema' }
    }
  */
    const payload = req.body;
    payload.type = payload.type.toLowerCase().replace(" ", "_");
    payload.value = payload.value.toLowerCase();

    const [lastData, isExist] = await Promise.all([
      ReffparamModel.findOne({ type: payload.type }).sort({ key: -1 }).lean(),
      crudServices.findOne(ReffparamModel, {
        query: { value: payload.value },
      }),
    ]);

    if (isExist.data) throw new BadRequest(`duplicate data ${payload.value}`);

    payload.key = lastData ? lastData.key + 1 : 1;

    const result = await crudServices.create(ReffparamModel, {
      data: payload,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

controller.update = async (req, res, next) => {
  try {
    /*
    #swagger.security = [{
      "bearerAuth": []
    }]
  */
    /*
    #swagger.tags = ['REF PARAMETER']
    #swagger.summary = 'ref parameter'
    #swagger.description = 'untuk referensi group'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create role',
      schema: { $ref: '#/definitions/BodyRefParameterSchema' }
    }
  */
    const payload = req.body;
    const id = req.params.id;

    payload.type = payload.type.toLowerCase().replace(" ", "_");
    payload.value = payload.value.toLowerCase();
    const data = crudServices.update(ReffparamModel, { id, data: payload });

    res.status(201).json(data);
  } catch (err) {
    next();
  }
};

controller.delete = async (req, res, next) => {
  try {
    /*
    #swagger.security = [{
      "bearerAuth": []
    }]
  */
    /*
    #swagger.tags = ['REF PARAMETER']
    #swagger.summary = 'ref parameter'
    #swagger.description = 'untuk referensi group'
  */
    const id = req.params.id;

    const result = await crudServices.delete(ReffparamModel, { id });

    res.status(200).json(result);
  } catch (err) {
    next();
  }
};

module.exports = controller;
