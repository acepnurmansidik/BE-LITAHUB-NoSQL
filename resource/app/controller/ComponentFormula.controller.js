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
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { search, branch_id } = req.query;

    const query = { is_delete: { $ne: true } };
    if (search) {
      query["$or"] = [{ name: { $regex: search, $options: "i" } }];
    }

    const [data, total] = await Promise.all([
      ComponentFormulaModel.find(query)
        .populate("branch_id", "name code")
        .sort({ _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      ComponentFormulaModel.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: total,
      current_page: page,
    });
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
    if (
      Array.isArray(component.component_id) &&
      component.component_id.length
    ) {
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
