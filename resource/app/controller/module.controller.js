const crudServices = require("../../helper/crudService");
const globalService = require("../../helper/global-func");
const ModuleModel = require("../models/Module.model");
const controller = {};

controller.getAllModule = async (req, res, next) => {
  /*
    #swagger.tags = ['MODULE']
    #swagger.summary = 'Module'
    #swagger.description = 'untuk referensi group'
    #swagger.parameters['search'] = { default: '', description: 'search by value' }
    #swagger.parameters['limit'] = { default: 10, description: 'limit' }
    #swagger.parameters['page'] = { default: 1, description: 'page' }
  */
  try {
    const query = {};
    const populateField = [];
    const { search, page, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const arrFilter = [];
    if (search) {
      arrFilter.push({ name: { $regex: search, $options: "i" } });
    }
    if (arrFilter.length) query["$or"] = arrFilter;

    const [page_size, result] = await Promise.all([
      ModuleModel.countDocuments(query),
      crudServices.findAllPagination(ModuleModel, {
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

controller.createModule = async (req, res, next) => {
  try {
    /*
    #swagger.tags = ['MODULE']
    #swagger.summary = 'Module'
    #swagger.description = 'untuk referensi group'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create role',
      schema: { $ref: '#/definitions/BodyModuleSchema' }
    }
  */
    const payload = req.body;
    payload.name = payload.name.toLowerCase();
    payload.slug = globalService.createSlug(payload.name);

    const result = await crudServices.create(ModuleModel, { data: payload });
    res.status(201).json({
      code: 201,
      success: true,
      message: "Module created successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.updateModule = async (req, res, next) => {
  try {
    /*
    #swagger.tags = ['MODULE']
    #swagger.summary = 'Module'
    #swagger.description = 'untuk referensi group'
    #swagger.parameters['id'] = { description: 'id role' }
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Update role',
      schema: { $ref: '#/definitions/BodyModuleSchema' }
    }
  */
    const { id } = req.params;
    const payload = req.body;
    payload.name = payload.name.toLowerCase();
    payload.slug = globalService.createSlug(payload.value);

    const result = await crudServices.update(ModuleModel, {
      id,
      data: payload,
    });
    res.status(200).json({
      code: 200,
      success: true,
      message: "Module updated successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.deleteModule = async (req, res, next) => {
  try {
    /*
    #swagger.tags = ['MODULE']
    #swagger.summary = 'Module'
    #swagger.description = 'untuk referensi group'
    #swagger.parameters['id'] = { description: 'id role' }
  */
    const { id } = req.params;
    const result = await crudServices.delete(ModuleModel, { id });
    res.status(200).json({
      code: 200,
      success: true,
      message: "Module deleted successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = controller;
