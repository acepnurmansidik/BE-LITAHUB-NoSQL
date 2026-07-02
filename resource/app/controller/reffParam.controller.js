const ReffParamModel = require("../models/ReffParam.model");
const crudServices = require("../../helper/crudService");
const BadRequest = require("../../utils/errors/bad-request");

const controller = {};

controller.index = async (req, res, next) => {
  const query = {};
  const { search, type, page, limit = 10 } = req.query;
  const skip = (page - 1) * limit;
  if (query.length) query.type = type;
  const arrFilter = [];
  if (search) {
    arrFilter.push({ value: { $regex: search, $options: "i" } });
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
    #swagger.parameters['search'] = { default: '', description: 'search by value' }
    #swagger.parameters['limit'] = { default: 10, description: 'limit' }
    #swagger.parameters['page'] = { default: 1, description: 'page' }
  */
    const page_size = await ReffParamModel.countDocuments(query);
    const result = await crudServices.findAllPagination(ReffParamModel, {
      query,
      populateField,
      skip,
      limit,
    });

    res.status(200).json({ ...result, page_size, current_page: Number(page) });
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
      ReffParamModel.findOne({ type: payload.type }).sort({ key: -1 }).lean(),
      crudServices.findOne(ReffParamModel, {
        query: { value: payload.value },
      }),
    ]);

    if (isExist.data) throw new BadRequest(`duplicate data ${payload.value}`);

    payload.key = lastData ? lastData.key + 1 : 1;

    const result = await crudServices.create(ReffParamModel, {
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
    const data = crudServices.update(ReffParamModel, { id, data: payload });

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

    const result = await crudServices.delete(ReffParamModel, { id });

    res.status(200).json(result);
  } catch (err) {
    next();
  }
};

module.exports = controller;
