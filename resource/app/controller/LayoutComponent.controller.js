const { runWithOptionalTransaction } = require("../../helper/crudService");
const globalService = require("../../helper/global-func");
const BadRequest = require("../../utils/errors/bad-request");
const NotFound = require("../../utils/errors/not-found");
const LayoutComponentModel = require("../models/LayoutComponent.model");
const ImageModel = require("../models/Image.model");
const LogActionModel = require("../models/LogAction.model");

const controller = {};

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['Layout Component']
    #swagger.summary = 'List Layout Components'
    #swagger.description = 'Retrieve a paginated list of layout components with optional search by name or category.'
    #swagger.parameters['page'] = { default: 1, description: 'Page number' }
    #swagger.parameters['limit'] = { default: 10, description: 'Number of items per page' }
    #swagger.parameters['search'] = { default: '', description: 'Filter by layout name or category' }
    */
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { search } = req.query;

    const query = { is_delete: { $ne: true } };
    if (search) {
      query["$or"] = [
        { name: { $regex: search, $options: "i" } },
        { category: { $regex: search, $options: "i" } },
      ];
    }

    const [data, total] = await Promise.all([
      LayoutComponentModel.find(query)
        .sort({ _id: -1 })
        .populate("image_id", "path")
        .skip((page - 1) * limit)
        .limit(limit)
        .select("-is_delete"),
      LayoutComponentModel.countDocuments(query),
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

controller.grouped = async (req, res, next) => {
  /*
    #swagger.tags = ['Layout Component']
    #swagger.summary = 'List layout components grouped by category'
    #swagger.description = 'Return every layout component grouped by its category for the floor-plan canvas palette.'
  */
  try {
    const data = await LayoutComponentModel.aggregate([
      { $match: { is_delete: { $ne: true } } },
      {
        $lookup: {
          from: ImageModel.collection.collectionName,
          localField: "image_id",
          foreignField: "_id",
          as: "image",
        },
      },
      { $unwind: { path: "$image", preserveNullAndEmptyArrays: true } },
      { $sort: { name: 1 } },
      {
        $group: {
          _id: "$category",
          items: {
            $push: {
              _id: "$_id",
              name: "$name",
              category: "$category",
              image_id: {
                $cond: [
                  { $ifNull: ["$image._id", false] },
                  { _id: "$image._id", path: "$image.path" },
                  null,
                ],
              },
            },
          },
        },
      },
      { $project: { _id: 0, category: "$_id", items: 1 } },
      { $sort: { category: 1 } },
    ]);

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
    });
  } catch (error) {
    next(error);
  }
};

controller.show = async (req, res, next) => {
  /*
    #swagger.tags = ['Layout Component']
    #swagger.summary = 'Get Layout Component detail'
    #swagger.description = 'Retrieve the details of a single layout component by its ID.'
    #swagger.parameters['id'] = { description: 'layout component id' }
  */
  try {
    const { id } = req.params;
    const data = await LayoutComponentModel.findOne({
      _id: id,
      is_delete: { $ne: true },
    })
      .populate("image_id", "path")
      .lean();
    if (!data) throw new NotFound("Data not found!");

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
    #swagger.tags = ['Layout Component']
    #swagger.summary = 'Create Layout Component'
    #swagger.description = 'Create a new layout component used on the floor-plan canvas.'
    #swagger.parameters['obj'] = {
      in: 'body', description: 'Create layout components',
      schema: { $ref: '#/definitions/BodyLayoutComponentSchema' }
    }
  */
  try {
    const payload = req.body;
    if (!payload?.name) throw new BadRequest("Name is required.");

    const result = await runWithOptionalTransaction(async (session) => {
      const [doc] = await LayoutComponentModel.create(
        [
          {
            category: payload.category,
            name: globalService.toTitleCase(payload.name),
            image_id: payload.image_id ?? null,
            created_by: req?.login?.user_id ?? null,
          },
        ],
        { session },
      );

      await globalService.setImageStatus(payload.image_id, true, session);

      await LogActionModel.create(
        [
          {
            target_id: doc._id,
            source: LayoutComponentModel.collection.collectionName,
            activities: [
              {
                type: "CREATE",
                after: doc.toObject(),
                created_by: req?.login?.user_id ?? null,
              },
            ],
          },
        ],
        { session },
      );

      return doc;
    });

    res.status(201).json({
      code: 201,
      success: true,
      message: "Layout component created successfully!",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

controller.update = async (req, res, next) => {
  /*
    #swagger.tags = ['Layout Component']
    #swagger.summary = 'Update Layout Component'
    #swagger.description = 'Update an existing layout component identified by its ID.'
    #swagger.parameters['id'] = { description: 'layout component id' }
    #swagger.parameters['obj'] = {
      in: 'body', description: 'Update layout components',
      schema: { $ref: '#/definitions/BodyLayoutComponentSchema' }
    }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await LayoutComponentModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new NotFound("Data not found!");
      const before = doc.toObject();

      // Sinkronkan flag status Image bila gambar berganti.
      if (payload.image_id !== undefined) {
        const beforeImg = before.image_id ? String(before.image_id) : null;
        const newImg = payload.image_id ?? null;
        if (newImg !== beforeImg) {
          await globalService.setImageStatus(beforeImg, false, session);
          await globalService.setImageStatus(newImg, true, session);
        }
      }

      if (payload.name !== undefined) {
        doc.name = globalService.toTitleCase(payload.name);
      }
      if (payload.category !== undefined) doc.category = payload.category;
      if (payload.image_id !== undefined) doc.image_id = payload.image_id;

      await doc.save({ session });

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: LayoutComponentModel.collection.collectionName,
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
      code: 200,
      success: true,
      message: "Layout component updated successfully!",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

controller.delete = async (req, res, next) => {
  /*
    #swagger.tags = ['Layout Component']
    #swagger.summary = 'Delete Layout Component (soft delete)'
    #swagger.description = 'Soft-delete a layout component and release its linked image.'
    #swagger.parameters['id'] = { description: 'layout component id' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await LayoutComponentModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new NotFound("Data not found!");
      const before = doc.toObject();

      doc.is_delete = true;
      await doc.save({ session });

      // Lepas gambar yang terpakai.
      await globalService.setImageStatus(before.image_id, false, session);

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: LayoutComponentModel.collection.collectionName,
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
      code: 200,
      success: true,
      message: "Layout component deleted successfully!",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = controller;
