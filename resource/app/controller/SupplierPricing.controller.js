const { runWithOptionalTransaction } = require("../../helper/crudService");
const { nextInventorySeq } = require("../../helper/inventorySequence");
const globalService = require("../../helper/global-func");
const BadRequest = require("../../utils/errors/bad-request");
const NotFound = require("../../utils/errors/not-found");
const ProductCategoryModel = require("../models/ProductCategory.model");
const LogActionModel = require("../models/LogAction.model");
const SupplierPricingModel = require("../models/SupplierPricing.model");

const controller = {};

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['Supplier Pricing']
    #swagger.summary = 'List Supplier Pricing'
    #swagger.description = 'Retrieve a paginated list of supplier pricing with optional unit & search filters.'
    #swagger.parameters['page'] = { default: 1 }
    #swagger.parameters['limit'] = { default: 10 }
    #swagger.parameters['search'] = { default: '', description: 'name / code' }
    #swagger.parameters['uom_id'] = { default: '' }
    #swagger.parameters['name'] = { default: '', description: 'exact product name (uppercase-insensitive) — supplier untuk sebuah produk' }
  */
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { search, uom_id, name } = req.query;

    const query = { is_delete: { $ne: true } };
    if (uom_id) query.uom_id = uom_id;
    // Filter cocok-persis nama produk (nama disimpan uppercase). Dipakai untuk
    // mengambil supplier yang memiliki produk tersebut (form PO).
    if (name) query.name = String(name).trim().toUpperCase();
    if (search) {
      query["$or"] = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
      ];
    }

    const [data, total] = await Promise.all([
      SupplierPricingModel.find(query)
        .populate("supplier_id", "name code")
        .populate("uom_id", "name code")
        .populate("product_image_id", "path")
        .sort({ _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      SupplierPricingModel.countDocuments(query),
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
    #swagger.tags = ['Supplier Pricing']
    #swagger.summary = 'Get Supplier Pricing detail'
    #swagger.parameters['id'] = { description: 'id supplier pricing' }
  */
  try {
    const { id } = req.params;
    const data = await SupplierPricingModel.findOne({
      _id: id,
      is_delete: { $ne: true },
    })
      .populate("uom_id", "name code")
      .populate("product_image_id", "path");
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
    #swagger.tags = ['Supplier Pricing']
    #swagger.summary = 'Create Supplier Pricing'
    #swagger.description = 'Create a new supplier pricing entry.'
    #swagger.parameters['obj'] = {
      in: 'body', description: 'Create product',
      schema: { $ref: '#/definitions/BodyProductSchema' }
    }
  */
  try {
    const payload = req.body;
    if (!payload?.uom_id) throw new BadRequest("uom_id is required.");
    if (!payload?.name) throw new BadRequest("name is required.");

    const result = await runWithOptionalTransaction(async (session) => {
      // Kode/SKU: manual (validasi unik) atau auto-generate per kategori.
      const [product] = await SupplierPricingModel.create([{ ...payload }], {
        session,
      });

      // Tandai gambar terpilih sebagai dipakai (status = true).
      await globalService.setImageStatus(product.product_image_id, true, session);

      await LogActionModel.create(
        [
          {
            target_id: product._id,
            source: SupplierPricingModel.collection.collectionName,
            activities: [
              {
                type: "CREATE",
                after: product.toObject(),
                created_by: req?.login?.user_id ?? null,
              },
            ],
          },
        ],
        { session },
      );

      return product;
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
    #swagger.tags = ['Supplier Pricing']
    #swagger.summary = 'Update Supplier Pricing'
    #swagger.description = 'Update an existing supplier pricing entry and reconcile its linked image.'
    #swagger.parameters['id'] = { description: 'id supplier pricing' }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await SupplierPricingModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new NotFound(`Data with id '${id}' not found!`);

      const before = doc.toObject();
      const prevImageId = doc.product_image_id
        ? String(doc.product_image_id)
        : null;

      // Slug stabil setelah dibuat.
      delete payload.slug;
      doc.set(payload);
      await doc.save({ session });

      // Bila gambar berubah: lepas gambar lama, pakai gambar baru.
      const nextImageId = doc.product_image_id
        ? String(doc.product_image_id)
        : null;
      if (prevImageId !== nextImageId) {
        await globalService.setImageStatus(prevImageId, false, session);
        await globalService.setImageStatus(nextImageId, true, session);
      }

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: SupplierPricingModel.collection.collectionName,
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
    #swagger.tags = ['Supplier Pricing']
    #swagger.summary = 'Delete Supplier Pricing (soft delete)'
    #swagger.parameters['id'] = { description: 'id supplier pricing' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await SupplierPricingModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new NotFound(`Data with id '${id}' not found!`);

      const before = doc.toObject();
      doc.is_delete = true;
      await doc.save({ session });

      // Lepas gambar (status = false) saat produk dihapus.
      await globalService.setImageStatus(doc.product_image_id, false, session);

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: SupplierPricingModel.collection.collectionName,
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
