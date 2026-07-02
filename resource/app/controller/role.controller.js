const crudServices = require("../../helper/crudService");
const globalService = require("../../helper/global-func");
const RoleModel = require("../models/Role.model");
const controller = {};

controller.getAllRole = async (req, res, next) => {
  /*
    #swagger.tags = ['ROLE']
    #swagger.summary = 'Role'
    #swagger.description = 'untuk referensi group'
    #swagger.parameters['search'] = { default: '', description: 'search by value' }
    #swagger.parameters['limit'] = { default: 10, description: 'limit' }
    #swagger.parameters['page'] = { default: 1, description: 'page' }
  */
  try {
    const query = {};
    const populateField = [];
    const { search, type, page, limit = 10 } = req.query;
    const skip = (page - 1) * limit;
    if (query.length) query.type = type;
    const arrFilter = [];
    if (search) {
      arrFilter.push({ name: { $regex: search, $options: "i" } });
    }
    if (arrFilter.length) query["$or"] = arrFilter;

    const page_size = await RoleModel.countDocuments(query);
    const result = await crudServices.findAllPagination(RoleModel, {
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

controller.createRole = async (req, res, next) => {
  try {
    /*
    #swagger.tags = ['ROLE']
    #swagger.summary = 'Role'
    #swagger.description = 'untuk referensi group'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create role',
      schema: { $ref: '#/definitions/BodyRoleSchema' }
    }
  */
    const payload = req.body;
    payload.name = payload.name.toLowerCase();
    payload.slug = globalService.createSlug(payload.name);

    const result = await crudServices.create(RoleModel, { data: payload });
    res.status(201).json({
      code: 201,
      success: true,
      message: "Role created successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.updateRole = async (req, res, next) => {
  try {
    /*
    #swagger.tags = ['ROLE']
    #swagger.summary = 'Role'
    #swagger.description = 'untuk referensi group'
    #swagger.parameters['id'] = { description: 'id role' }
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Update role',
      schema: { $ref: '#/definitions/BodyRoleSchema' }
    }
  */
    const { id } = req.params;
    const payload = req.body;
    payload.name = payload.name.toLowerCase();
    payload.slug = globalService.createSlug(payload.value);

    const result = await crudServices.update(RoleModel, { id, data: payload });
    res.status(200).json({
      code: 200,
      success: true,
      message: "Role updated successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.deleteRole = async (req, res, next) => {
  try {
    /*
    #swagger.tags = ['ROLE']
    #swagger.summary = 'Role'
    #swagger.description = 'untuk referensi group'
    #swagger.parameters['id'] = { description: 'id role' }
  */
    const { id } = req.params;
    const result = await crudServices.delete(RoleModel, { id });
    res.status(200).json({
      code: 200,
      success: true,
      message: "Role deleted successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = controller;
