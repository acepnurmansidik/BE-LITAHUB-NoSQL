const { runWithOptionalTransaction } = require("../../helper/crudService");
const BadRequest = require("../../utils/errors/bad-request");
const NotFound = require("../../utils/errors/not-found");
const ProductCategoryModel = require("../models/ProductCategory.model");
const LogActionModel = require("../models/LogAction.model");
const globalService = require("../../helper/global-func");

const controller = {};

// Bangun baris line_accounts dari payload ({ title, account_id,
// product_category_id? }[]). product_category_id null bila tidak dipilih.
const buildLineAccounts = (rawList) => {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .filter((row) => row && row.title && row.account_id)
    .map((row) => ({
      title: String(row.title).trim(),
      account_id: row.account_id,
      product_category_id: row.product_category_id || null,
    }));
};

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['Product Category']
    #swagger.summary = 'List Product Categories'
    #swagger.description = 'Retrieve a paginated list of product categories with their line accounts.'
    #swagger.parameters['page'] = { default: 1 }
    #swagger.parameters['limit'] = { default: 10 }
    #swagger.parameters['search'] = { default: '', description: 'name / prefix' }
  */
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { search } = req.query;

    const query = { is_delete: { $ne: true } };
    if (search) {
      query["$or"] = [
        { name: { $regex: search, $options: "i" } },
        { prefix: { $regex: search, $options: "i" } },
      ];
    }

    const [data, total] = await Promise.all([
      ProductCategoryModel.find(query)
        .populate("line_accounts.account_id", "code name")
        .sort({ _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      ProductCategoryModel.countDocuments(query),
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
    #swagger.tags = ['Product Category']
    #swagger.summary = 'Get Product Category detail'
    #swagger.parameters['id'] = { description: 'id product category' }
  */
  try {
    const { id } = req.params;
    const data = await ProductCategoryModel.findOne({
      _id: id,
      is_delete: { $ne: true },
    }).populate("line_accounts.account_id", "code name");
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
    #swagger.tags = ['Product Category']
    #swagger.summary = 'Create Product Category'
    #swagger.description = 'Create a new product category with embedded line accounts.'
    #swagger.parameters['obj'] = {
      in: 'body', description: 'Create product category',
      schema: { $ref: '#/definitions/BodyProductCategorySchema' }
    }
  */
  try {
    const payload = req.body;
    if (!payload?.name) throw new BadRequest("Category name is required.");
    if (!payload?.prefix) throw new BadRequest("Prefix is required.");

    const result = await runWithOptionalTransaction(async (session) => {
      const [category] = await ProductCategoryModel.create(
        [
          {
            name: payload.name,
            prefix: payload.prefix,
            is_active: payload.is_active,
            line_accounts: buildLineAccounts(payload.line_accounts),
          },
        ],
        { session },
      );

      await LogActionModel.create(
        [
          {
            target_id: category._id,
            source: ProductCategoryModel.collection.collectionName,
            activities: [
              {
                type: "CREATE",
                after: category.toObject(),
                created_by: req?.login?.user_id ?? null,
              },
            ],
          },
        ],
        { session },
      );

      return category;
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
    #swagger.tags = ['Product Category']
    #swagger.summary = 'Update Product Category'
    #swagger.description = 'Update an existing product category and replace its line accounts when provided.'
    #swagger.parameters['id'] = { description: 'id product category' }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await ProductCategoryModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new NotFound(`Data with id '${id}' not found!`);

      const before = doc.toObject();

      // Slug stabil setelah dibuat — jangan ditimpa dari body.
      payload.slug = globalService.createSlug(payload.name);
      if (payload.name !== undefined) doc.name = payload.name;
      if (payload.prefix !== undefined) doc.prefix = payload.prefix;
      if (payload.is_active !== undefined) doc.is_active = payload.is_active;
      if (payload.line_accounts !== undefined) {
        doc.line_accounts = buildLineAccounts(payload.line_accounts);
      }
      await doc.save({ session });

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: ProductCategoryModel.collection.collectionName,
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
    #swagger.tags = ['Product Category']
    #swagger.summary = 'Delete Product Category (soft delete)'
    #swagger.parameters['id'] = { description: 'id product category' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await ProductCategoryModel.findOne({
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
            source: ProductCategoryModel.collection.collectionName,
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
