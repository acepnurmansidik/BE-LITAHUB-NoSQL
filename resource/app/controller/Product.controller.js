const { runWithOptionalTransaction } = require("../../helper/crudService");
const { nextInventorySeq } = require("../../helper/inventorySequence");
const globalService = require("../../helper/global-func");
const BadRequest = require("../../utils/errors/bad-request");
const NotFound = require("../../utils/errors/not-found");
const ProductModel = require("../models/Product.model");
const ProductCategoryModel = require("../models/ProductCategory.model");
const ImageModel = require("../models/Image.model");
const LogActionModel = require("../models/LogAction.model");

const controller = {};

// Set flag `status` pada Image (true = dipakai, false = lepas). Aman untuk id
// null/undefined (langsung di-skip).
const setImageStatus = async (imageId, status, session) => {
  if (!imageId) return;
  await ImageModel.findOneAndUpdate({ _id: imageId }, { status }, { session });
};

// Cek apakah kode produk sudah dipakai (non-deleted).
const productCodeExists = async (code, session) =>
  !!(await ProductModel.exists({ code, is_delete: { $ne: true } }).session(
    session ?? null,
  ));

// Tentukan kode produk: manual (validasi unik) atau otomatis (sequence per
// kategori: PREFIX-#### dengan urut khusus product per product_category).
const resolveProductCode = async (payload, session) => {
  if (payload.code) {
    const code = String(payload.code).trim().toUpperCase();
    if (await productCodeExists(code, session)) {
      throw new BadRequest(`Product code '${code}' already exists.`);
    }
    return code;
  }

  const category = await ProductCategoryModel.findOne({
    _id: payload.product_category_id,
    is_delete: { $ne: true },
  }).session(session);
  if (!category) throw new BadRequest("Product category not found.");
  const prefix = (category.prefix || "PRD").toUpperCase();

  // Loop sampai dapat kode yang belum terpakai (aman dari kode manual bentrok).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const seq = await nextInventorySeq(`PRODUCT:${category._id}`, session);
    const code = `${prefix}-${String(seq).padStart(5, "0")}`;
    // eslint-disable-next-line no-await-in-loop
    if (!(await productCodeExists(code, session))) return code;
  }
};

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['Product']
    #swagger.summary = 'List products'
    #swagger.parameters['page'] = { default: 1 }
    #swagger.parameters['limit'] = { default: 10 }
    #swagger.parameters['search'] = { default: '', description: 'name / code' }
    #swagger.parameters['product_category_id'] = { default: '' }
    #swagger.parameters['uom_id'] = { default: '' }
  */
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { search, product_category_id, uom_id } = req.query;

    const query = { is_delete: { $ne: true } };
    if (product_category_id) query.product_category_id = product_category_id;
    if (uom_id) query.uom_id = uom_id;
    if (search) {
      query["$or"] = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
      ];
    }

    const [data, total] = await Promise.all([
      ProductModel.find(query)
        .populate("product_category_id", "name prefix")
        .populate("uom_id", "name code")
        .populate("product_image_id", "path")
        .sort({ _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      ProductModel.countDocuments(query),
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
    #swagger.tags = ['Product']
    #swagger.summary = 'Detail product'
    #swagger.parameters['id'] = { description: 'id product' }
  */
  try {
    const { id } = req.params;
    const data = await ProductModel.findOne({
      _id: id,
      is_delete: { $ne: true },
    })
      .populate("product_category_id", "name prefix")
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
    #swagger.tags = ['Product']
    #swagger.summary = 'Create product'
    #swagger.parameters['obj'] = {
      in: 'body', description: 'Create product',
      schema: { $ref: '#/definitions/BodyProductSchema' }
    }
  */
  try {
    const payload = req.body;
    if (!payload?.product_category_id)
      throw new BadRequest("product_category_id is required.");
    if (!payload?.uom_id) throw new BadRequest("uom_id is required.");
    if (!payload?.name) throw new BadRequest("name is required.");

    const result = await runWithOptionalTransaction(async (session) => {
      // Kode/SKU: manual (validasi unik) atau auto-generate per kategori.
      const code = await resolveProductCode(payload, session);
      const [product] = await ProductModel.create([{ ...payload, code }], {
        session,
      });

      // Tandai gambar terpilih sebagai dipakai (status = true).
      await setImageStatus(product.product_image_id, true, session);

      await LogActionModel.create(
        [
          {
            target_id: product._id,
            source: ProductModel.collection.collectionName,
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
    #swagger.tags = ['Product']
    #swagger.summary = 'Update product'
    #swagger.parameters['id'] = { description: 'id product' }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await ProductModel.findOne({
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
        await setImageStatus(prevImageId, false, session);
        await setImageStatus(nextImageId, true, session);
      }

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: ProductModel.collection.collectionName,
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
    #swagger.tags = ['Product']
    #swagger.summary = 'Delete product (soft delete)'
    #swagger.parameters['id'] = { description: 'id product' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await ProductModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new NotFound(`Data with id '${id}' not found!`);

      const before = doc.toObject();
      doc.is_delete = true;
      await doc.save({ session });

      // Lepas gambar (status = false) saat produk dihapus.
      await setImageStatus(doc.product_image_id, false, session);

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: ProductModel.collection.collectionName,
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
