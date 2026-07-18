const ComponentFormulaModel = require("../models/ComponentFormula.model");
const crudServices = require("../../helper/crudService");
const globalService = require("../../helper/global-func");
const BadRequest = require("../../utils/errors/bad-request");

const controller = {};

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['COMPONENT FORMULA']
    #swagger.summary = 'Component Formula'
    #swagger.description = 'Komponen dasar untuk perhitungan CalculatedFormula'
    #swagger.parameters['search'] = { default: '', description: 'search by name' }
    #swagger.parameters['limit'] = { default: 10, description: 'limit' }
    #swagger.parameters['page'] = { default: 1, description: 'page' }
  */
  try {
    const query = {};
    const { search, page, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const arrFilter = [];
    if (search) {
      arrFilter.push({ name: { $regex: search, $options: "i" } });
    }
    if (arrFilter.length) query["$or"] = arrFilter;

    const [page_size, result] = await Promise.all([
      ComponentFormulaModel.countDocuments({
        ...query,
        is_delete: { $ne: true },
      }),
      crudServices.findAllPagination(ComponentFormulaModel, {
        query,
        skip,
        limit,
      }),
    ]);

    res.status(200).json({ ...result, page_size, current_page: Number(page) });
  } catch (err) {
    next(err);
  }
};

controller.create = async (req, res, next) => {
  /*
    #swagger.tags = ['COMPONENT FORMULA']
    #swagger.summary = 'Component Formula'
    #swagger.description = 'Buat komponen formula baru'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create component formula',
      schema: { $ref: '#/definitions/BodyComponentFormulaSchema' }
    }
  */
  try {
    const payload = req.body;
    payload.name = payload.name.toLowerCase();
    payload.slug = globalService.createSlug(payload.name);
    // component_id tidak boleh diisi dari client; dikelola oleh CalculatedFormula.
    delete payload.component_id;

    const result = await crudServices.create(ComponentFormulaModel, {
      data: payload,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

controller.update = async (req, res, next) => {
  /*
    #swagger.tags = ['COMPONENT FORMULA']
    #swagger.summary = 'Component Formula'
    #swagger.description = 'Perbarui komponen formula'
    #swagger.parameters['id'] = { description: 'id component formula' }
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Update component formula',
      schema: { $ref: '#/definitions/BodyComponentFormulaSchema' }
    }
  */
  try {
    const { id } = req.params;
    const payload = req.body;
    if (payload.name) {
      payload.name = payload.name.toLowerCase();
      payload.slug = globalService.createSlug(payload.name);
    }
    // Relasi component_id hanya dikelola lewat CalculatedFormula, bukan dari sini.
    delete payload.component_id;

    const result = await crudServices.update(ComponentFormulaModel, {
      id,
      data: payload,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

controller.delete = async (req, res, next) => {
  /*
    #swagger.tags = ['COMPONENT FORMULA']
    #swagger.summary = 'Component Formula'
    #swagger.description = 'Hapus komponen formula (hanya bila tidak dipakai)'
    #swagger.parameters['id'] = { description: 'id component formula' }
  */
  try {
    const { id } = req.params;

    const component = await ComponentFormulaModel.findOne({
      _id: id,
      is_delete: { $ne: true },
    }).lean();

    if (!component) throw new BadRequest("Data not found!");

    // Guard: komponen masih dipakai oleh satu atau lebih CalculatedFormula.
    if (Array.isArray(component.component_id) && component.component_id.length) {
      throw new BadRequest(
        "Cannot delete this component because it is still used by one or more calculated formulas. Remove it from those formulas first.",
      );
    }

    const result = await crudServices.delete(ComponentFormulaModel, { id });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

module.exports = controller;
