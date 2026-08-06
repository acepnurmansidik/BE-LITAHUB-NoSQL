const { runWithOptionalTransaction } = require("../../helper/crudService");
const { nextInventorySeq } = require("../../helper/inventorySequence");
const globalService = require("../../helper/global-func");
const BadRequest = require("../../utils/errors/bad-request");
const NotFound = require("../../utils/errors/not-found");
const SupplierModel = require("../models/Supplier.model");
const LogActionModel = require("../models/LogAction.model");

const controller = {};

// Tentukan kode supplier: manual (validasi unik) atau otomatis (SUP-####,
// sequence khusus supplier).
const resolveSupplierCode = async (payload, session) => {
  const exists = async (code) =>
    !!(await SupplierModel.exists({ code, is_delete: { $ne: true } }).session(
      session ?? null,
    ));

  if (payload.code) {
    const code = String(payload.code).trim().toUpperCase();
    if (await exists(code)) {
      throw new BadRequest(`Supplier code '${code}' already exists.`);
    }
    return code;
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const seq = await nextInventorySeq("SUPPLIER", session);
    const code = `SUP-${String(seq).padStart(5, "0")}`;
    // eslint-disable-next-line no-await-in-loop
    if (!(await exists(code))) return code;
  }
};

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['Supplier']
    #swagger.summary = 'Get supplier'
    #swagger.description = 'Endpoint to list supplier.'
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
      SupplierModel.find(query)
        .sort({ _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      SupplierModel.countDocuments(query),
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
    #swagger.tags = ['Supplier']
    #swagger.summary = 'Detail supplier'
    #swagger.parameters['id'] = { description: 'id supplier' }
  */
  try {
    const { id } = req.params;
    const data = await SupplierModel.findOne({
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
    #swagger.tags = ['Supplier']
    #swagger.summary = 'Create a new supplier'
    #swagger.description = 'Endpoint to create a supplier. Slug is auto-generated from name.'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create supplier',
      schema: { $ref: '#/definitions/BodySupplierSchema' }
    }
  */
  try {
    const payload = req.body;
    if (!payload?.name) throw new BadRequest("Supplier name is required.");

    const result = await runWithOptionalTransaction(async (session) => {
      // Kode: manual (validasi unik) atau auto-generate (SUP-####).
      const code = await resolveSupplierCode(payload, session);
      const [data] = await SupplierModel.create([{ ...payload, code }], {
        session,
      });
      await LogActionModel.create(
        [
          {
            target_id: data._id,
            source: SupplierModel.collection.collectionName,
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
    #swagger.tags = ['Supplier']
    #swagger.summary = 'Update a supplier'
    #swagger.parameters['id'] = { description: 'id supplier' }
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Update supplier',
      schema: { $ref: '#/definitions/BodySupplierSchema' }
    }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await SupplierModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new NotFound(`Data with id '${id}' not found!`);

      const before = doc.toObject();

      // Slug bersifat stabil setelah dibuat — jangan ditimpa dari body.
      delete payload.code;
      delete payload.slug;

      doc.set(payload);
      await doc.save({ session });

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: SupplierModel.collection.collectionName,
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
    #swagger.tags = ['Supplier']
    #swagger.summary = 'Delete a supplier (soft delete)'
    #swagger.parameters['id'] = { description: 'id supplier' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await SupplierModel.findOne({
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
            source: SupplierModel.collection.collectionName,
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
