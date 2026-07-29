const { runWithOptionalTransaction } = require("../../helper/crudService");
const globalService = require("../../helper/global-func");
const BadRequest = require("../../utils/errors/bad-request");
const NotFound = require("../../utils/errors/not-found");
const LayoutComponentModel = require("../models/LayoutComponent.model");
const ImageModel = require("../models/Image.model");
const LogActionModel = require("../models/LogAction.model");

const controller = {};

// Set flag `status` pada Image (true = dipakai, false = lepas). Aman untuk id
// null/kosong.
const setImageStatus = async (imageId, status, session) => {
  if (!imageId) return;
  await ImageModel.findOneAndUpdate({ _id: imageId }, { status }, { session });
};

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['Layout Component']
    #swagger.summary = 'Get layout components'
    #swagger.description = 'Retrieve a list of layout components with pagination and search functionality.'
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
    #swagger.summary = 'Get all layout components grouped by category'
    #swagger.description = 'Return every layout component grouped by its category. Used by the floor-plan canvas palette.'
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
    #swagger.summary = 'Get layout component by ID'
    #swagger.description = 'Retrieve detailed information of a specific layout component by its unique ID.'
    #swagger.parameters['id'] = { description: 'id layout component' }
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
    #swagger.summary = 'Create layout components'
    #swagger.description = 'Create a new building component layout.'
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

      await setImageStatus(payload.image_id, true, session);

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
    #swagger.summary = 'Update layout components'
    #swagger.description = 'Update an existing building component layout.'
    #swagger.parameters['id'] = { description: 'id layout component' }
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
          await setImageStatus(beforeImg, false, session);
          await setImageStatus(newImg, true, session);
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
    #swagger.summary = 'Delete layout components'
    #swagger.parameters['id'] = { description: 'id layout component' }
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
      await setImageStatus(before.image_id, false, session);

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

controller.uploadImage = async (req, res, next) => {
  /*
    #swagger.tags = ['Layout Component']
    #swagger.summary = 'Upload layout component image (stored in Image model)'
    #swagger.consumes = ['multipart/form-data']
    #swagger.parameters['proofs'] = {
      in: 'formData', type: 'array', required: true,
      collectionFormat: 'multi', items: { type: 'file' }
    }
  */
  try {
    const files = req?.files?.proofs;
    if (!files || files.length === 0) {
      throw new BadRequest("No image uploaded. Use form field 'proofs'.");
    }
    const fileResult = await globalService.uploadFiles(files);
    const data = fileResult.map((item) => ({ _id: item.id, path: item.path }));

    res.status(200).json({
      success: true,
      message: "Image uploaded successfully!",
      data,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = controller;
