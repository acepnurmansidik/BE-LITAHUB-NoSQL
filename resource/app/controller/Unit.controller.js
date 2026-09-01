const { runWithOptionalTransaction } = require("../../helper/crudService");
const { buildRoomCode, buildRoomName } = require("../../helper/codeGenerator");
const globalService = require("../../helper/global-func");
const BadRequest = require("../../utils/errors/bad-request");
const NotFound = require("../../utils/errors/not-found");
const BuildingFloorModel = require("../models/BuildingFloor.model");
const UnitModel = require("../models/Unit.model");
const LogActionModel = require("../models/LogAction.model");

const controller = {};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Cek apakah nama room sudah dipakai di lantai yang sama (case-insensitive).
// `excludeId` untuk mengabaikan dokumen sendiri saat update.
const nameExistsOnFloor = async (floorId, name, session, excludeId) => {
  const query = {
    floor_id: floorId,
    is_delete: { $ne: true },
    name: { $regex: `^${escapeRegex(String(name).trim())}$`, $options: "i" },
  };
  if (excludeId) query._id = { $ne: excludeId };
  const found = await UnitModel.findOne(query)
    .session(session ?? null)
    .lean();
  return !!found;
};

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['Unit']
    #swagger.summary = 'List Units'
    #swagger.description = 'Retrieve a paginated list of Units with optional search and filters by building, floor and status.'
    #swagger.parameters['page'] = { default: 1 }
    #swagger.parameters['limit'] = { default: 10 }
    #swagger.parameters['search'] = { default: '', description: 'name / code' }
    #swagger.parameters['building_id'] = { default: '' }
    #swagger.parameters['floor_id'] = { default: '' }
    #swagger.parameters['status'] = { default: '', description: 'available | occupied | under_maintenance | reserved' }
  */
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { search, building_id, floor_id, status } = req.query;

    const query = { is_delete: { $ne: true } };
    if (building_id) query.building_id = building_id;
    if (floor_id) query.floor_id = floor_id;
    if (status) query.status = status;
    if (search) {
      query["$or"] = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
      ];
    }

    const [data, total] = await Promise.all([
      UnitModel.find(query)
        .populate("building_id", "name code")
        .populate("floor_id", "name code floor_level")
        .populate("image_id", "path")
        .populate("amenities", "value type key")
        .populate({
          path: "component.component_id",
          select: "name category image_id",
          populate: { path: "image_id", select: "path" },
        })
        .sort({ _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      UnitModel.countDocuments(query),
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
    #swagger.tags = ['Unit']
    #swagger.summary = 'Get Unit detail'
    #swagger.description = 'Retrieve the details of a single Unit by its ID.'
    #swagger.parameters['id'] = { description: 'Unit id' }
  */
  try {
    const { id } = req.params;
    const data = await UnitModel.findOne({
      _id: id,
      is_delete: { $ne: true },
    })
      .populate("building_id", "name code")
      .populate("floor_id", "name code floor_level")
      .populate("image_id", "path")
      .populate("amenities", "value type key");
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
    #swagger.tags = ['Unit']
    #swagger.summary = 'Create Unit'
    #swagger.description = 'Create a Unit where the code and name follow the running room count on the floor.'
    #swagger.parameters['obj'] = {
      in: 'body', description: 'Create Unit',
      schema: { $ref: '#/definitions/BodyUnitSchema' }
    }
  */
  try {
    const payload = req.body;
    if (!payload?.floor_id) throw new BadRequest("floor_id is required.");

    const result = await runWithOptionalTransaction(async (session) => {
      // Ambil lantai beserta building-nya untuk menurunkan building/kode.
      const floor = await BuildingFloorModel.findOne({
        _id: payload.floor_id,
        is_delete: { $ne: true },
      })
        .populate("building_id")
        .session(session);
      if (!floor) throw new BadRequest("Floor not found.");
      if (!floor.building_id) throw new BadRequest("Floor has no building.");

      const building = floor.building_id;

      // Urutan ruangan berikutnya di lantai ini = jumlah ruangan + 1.
      const existingCount = await UnitModel.countDocuments({
        floor_id: floor._id,
        is_delete: { $ne: true },
      }).session(session);
      let index = existingCount + 1;

      // Nama unik per lantai. Nama eksplisit yang bentrok ditolak; nama
      // otomatis (Room N) di-increment sampai bebas.
      let name;
      if (payload.name) {
        name = String(payload.name).trim();
        if (await nameExistsOnFloor(floor._id, name, session)) {
          throw new BadRequest(
            `Room name '${name}' already exists on this floor.`,
          );
        }
      } else {
        name = buildRoomName(index);
        // eslint-disable-next-line no-await-in-loop
        while (await nameExistsOnFloor(floor._id, name, session)) {
          index += 1;
          name = buildRoomName(index);
        }
      }
      const [room] = await UnitModel.create(
        [
          {
            building_id: building._id,
            floor_id: floor._id,
            code: buildRoomCode(floor.code, index),
            name: name.toLocaleUpperCase(),
            slug: globalService.createSlug(name),
            unit_type: payload.unit_type,
            status: payload.status,
            capacity: payload.capacity,
            area_sqm: payload.area_sqm,
            amenities: payload.amenities,
            image_id: payload.image_id ?? null,
            notes: payload.notes,
            // Data penempatan di kanvas denah (posisi/skala/rotasi/warna/opacity).
            ...(payload.component ? { component: payload.component } : {}),
          },
        ],
        { session },
      );

      await LogActionModel.create(
        [
          {
            target_id: room._id,
            source: UnitModel.collection.collectionName,
            activities: [
              {
                type: "CREATE",
                after: room.toObject(),
                created_by: req?.login?.user_id ?? null,
              },
            ],
          },
        ],
        { session },
      );

      return room;
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
    #swagger.tags = ['Unit']
    #swagger.summary = 'Update Unit'
    #swagger.description = 'Update an existing Unit identified by its ID.'
    #swagger.parameters['id'] = { description: 'Unit id' }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await UnitModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new NotFound(`Data with id '${id}' not found!`);

      const before = doc.toObject();

      // Validasi nama unik per lantai bila nama diubah.
      if (payload.name !== undefined) {
        const newName = String(payload.name).trim();
        if (
          newName.toLowerCase() !== String(doc.name).toLowerCase() &&
          (await nameExistsOnFloor(doc.floor_id, newName, session, doc._id))
        ) {
          throw new BadRequest(
            `Room name '${newName}' already exists on this floor.`,
          );
        }
        payload.name = newName;
      }

      // Kode, slug & relasi induk stabil setelah dibuat.
      delete payload.code;
      delete payload.slug;
      delete payload.building_id;
      delete payload.floor_id;

      payload.name = payload.name.toLocaleUpperCase();
      doc.set(payload);
      await doc.save({ session });

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: UnitModel.collection.collectionName,
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
    #swagger.tags = ['Unit']
    #swagger.summary = 'Delete Unit (soft delete)'
    #swagger.description = 'Soft-delete a Unit by marking it as deleted without removing the record.'
    #swagger.parameters['id'] = { description: 'Unit id' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await UnitModel.findOne({
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
            source: UnitModel.collection.collectionName,
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
