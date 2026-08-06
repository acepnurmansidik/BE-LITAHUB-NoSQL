const { runWithOptionalTransaction } = require("../../helper/crudService");
const {
  buildFloorCode,
  buildFloorName,
} = require("../../helper/codeGenerator");
const globalService = require("../../helper/global-func");
const BadRequest = require("../../utils/errors/bad-request");
const NotFound = require("../../utils/errors/not-found");
const BuildingModel = require("../models/Building.model");
const BuildingFloorModel = require("../models/BuildingFloor.model");
const RoomUnitModel = require("../models/RoomUnit.model");
const LogActionModel = require("../models/LogAction.model");
const ImageModel = require("../models/Image.model");

const controller = {};

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['Building Floor']
    #swagger.summary = 'List Floors'
    #swagger.description = 'Retrieve a paginated list of building floors with optional search and filter by building.'
    #swagger.parameters['page'] = { default: 1 }
    #swagger.parameters['limit'] = { default: 10 }
    #swagger.parameters['search'] = { default: '', description: 'name / code' }
    #swagger.parameters['building_id'] = { default: '', description: 'filter by building' }
  */
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { search, building_id } = req.query;

    const query = { is_delete: { $ne: true } };
    if (building_id) query.building_id = building_id;
    if (search) {
      query["$or"] = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
      ];
    }

    const [data, total] = await Promise.all([
      BuildingFloorModel.find(query)
        .populate("building_id", "name code")
        .populate("floor_plan_url_id", "path")
        .sort({ floor_level: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      BuildingFloorModel.countDocuments(query),
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
    #swagger.tags = ['Building Floor']
    #swagger.summary = 'Get Floor detail'
    #swagger.description = 'Retrieve the details of a single building floor by its ID.'
    #swagger.parameters['id'] = { description: 'floor id' }
  */
  try {
    const { id } = req.params;
    const data = await BuildingFloorModel.findOne({
      _id: id,
      is_delete: { $ne: true },
    })
      .populate("building_id", "name code")
      .populate("floor_plan_url_id", "path");
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
    #swagger.tags = ['Building Floor']
    #swagger.summary = 'Create Floor'
    #swagger.description = 'Add a floor to a building where the code and name follow the running floor count.'
    #swagger.parameters['obj'] = {
      in: 'body', description: 'Create floor',
      schema: { $ref: '#/definitions/BodyBuildingFloorSchema' }
    }
  */
  try {
    const payload = req.body;
    if (!payload?.building_id) throw new BadRequest("building_id is required.");

    const result = await runWithOptionalTransaction(async (session) => {
      const building = await BuildingModel.findOne({
        _id: payload.building_id,
        is_delete: { $ne: true },
      }).session(session);
      if (!building) throw new BadRequest("Building not found.");

      // Urutan lantai berikutnya = jumlah lantai yang ada + 1.
      const existingCount = await BuildingFloorModel.countDocuments({
        building_id: building._id,
        is_delete: { $ne: true },
      }).session(session);
      const index = existingCount + 1;

      const name = payload.name || buildFloorName(index);
      const [floor] = await BuildingFloorModel.create(
        [
          {
            building_id: building._id,
            code: buildFloorCode(building.code, index),
            type: payload.type || "floor",
            name,
            slug: globalService.createSlug(name),
            floor_level: payload.floor_level ?? index,
            floor_area_sqm: payload.floor_area_sqm,
            max_capacity: payload.max_capacity,
            floor_plan_url_id: payload.floor_plan_url_id ?? null,
            notes: payload.notes,
          },
        ],
        { session },
      );

      if (payload.floor_plan_url_id) {
        await ImageModel.findOneAndUpdate(
          { _id: payload.floor_plan_url_id },
          { status: true },
          { session },
        );
      }

      // Building selalu punya minimal jumlah lantai ini.
      if (index > (building.total_floors ?? 0)) {
        building.total_floors = index;
        await building.save({ session });
      }

      await LogActionModel.create(
        [
          {
            target_id: floor._id,
            source: BuildingFloorModel.collection.collectionName,
            activities: [
              {
                type: "CREATE",
                after: floor.toObject(),
                created_by: req?.login?.user_id ?? null,
              },
            ],
          },
        ],
        { session },
      );

      return floor;
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
    #swagger.tags = ['Building Floor']
    #swagger.summary = 'Update Floor'
    #swagger.description = 'Update an existing building floor identified by its ID.'
    #swagger.parameters['id'] = { description: 'floor id' }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await BuildingFloorModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new NotFound(`Data with id '${id}' not found!`);

      const before = doc.toObject();

      // Kode & slug stabil setelah dibuat — jangan ditimpa dari body.
      delete payload.code;
      delete payload.slug;
      delete payload.building_id;
      doc.set(payload);
      await doc.save({ session });

      // Swap flag `status` gambar denah lantai — aman untuk id null (floor
      // tanpa gambar sebelumnya, atau gambar dilepas saat update).
      const prevImageId = before.floor_plan_url_id
        ? before.floor_plan_url_id.toString()
        : null;
      const nextImageId = payload.floor_plan_url_id
        ? payload.floor_plan_url_id.toString()
        : null;
      if (prevImageId !== nextImageId) {
        if (prevImageId) {
          await ImageModel.findOneAndUpdate(
            { _id: prevImageId },
            { status: false },
            { session },
          );
        }
        if (nextImageId) {
          await ImageModel.findOneAndUpdate(
            { _id: nextImageId },
            { status: true },
            { session },
          );
        }
      }
      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: BuildingFloorModel.collection.collectionName,
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
    #swagger.tags = ['Building Floor']
    #swagger.summary = 'Delete Floor (soft delete)'
    #swagger.description = 'Soft-delete a building floor and cascade the soft-delete to its rooms.'
    #swagger.parameters['id'] = { description: 'floor id' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await BuildingFloorModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new NotFound(`Data with id '${id}' not found!`);

      const before = doc.toObject();
      doc.is_delete = true;
      await doc.save({ session });

      await RoomUnitModel.updateMany(
        { floor_id: id },
        { is_delete: true },
        { session },
      );

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: BuildingFloorModel.collection.collectionName,
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
