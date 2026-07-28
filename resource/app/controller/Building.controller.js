const { runWithOptionalTransaction } = require("../../helper/crudService");
const {
  generateShortCode,
  buildFloorCode,
  buildFloorName,
} = require("../../helper/codeGenerator");
const globalService = require("../../helper/global-func");
const BadRequest = require("../../utils/errors/bad-request");
const NotFound = require("../../utils/errors/not-found");
const BranchModel = require("../models/Branch.model");
const BuildingModel = require("../models/Building.model");
const BuildingFloorModel = require("../models/BuildingFloor.model");
const RoomUnitModel = require("../models/RoomUnit.model");
const LogActionModel = require("../models/LogAction.model");

const controller = {};

// Cari kode unik untuk building. Kode dasar diturunkan dari nama (mis. ANGGREK
// -> AGRK); bila sudah dipakai, tambahkan sufiks angka (AGRK, AGRK2, AGRK3...).
const ensureUniqueBuildingCode = async (name, session) => {
  const base = generateShortCode(name, 4) || "BLDG";
  let code = base;
  let suffix = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await BuildingModel.exists({ code }).session(session ?? null)) {
    suffix += 1;
    code = `${base}${suffix}`;
  }
  return code;
};

// Bangun dokumen lantai 1..total. Kode & nama mengikuti urutan (counting):
//   code = "<BUILDING>-FLR<i>", name = "Floor <i>", floor_level = i.
const buildFloorDocs = (building, from, to) => {
  const docs = [];
  for (let i = from; i <= to; i += 1) {
    const name = buildFloorName(i);
    docs.push({
      building_id: building._id,
      code: buildFloorCode(building.code, i),
      type: "floor",
      name,
      slug: globalService.createSlug(name),
      floor_level: i,
    });
  }
  return docs;
};

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['Building']
    #swagger.summary = 'List building'
    #swagger.parameters['page'] = { default: 1 }
    #swagger.parameters['limit'] = { default: 10 }
    #swagger.parameters['search'] = { default: '', description: 'name / code' }
    #swagger.parameters['branch_id'] = { default: '', description: 'filter by branch' }
  */
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { search, branch_id } = req.query;

    const query = { is_delete: { $ne: true } };
    if (branch_id) query.branch_id = branch_id;
    if (search) {
      query["$or"] = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
      ];
    }

    const [data, total] = await Promise.all([
      BuildingModel.find(query)
        .populate("branch_id", "name code")
        .sort({ _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      BuildingModel.countDocuments(query),
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
    #swagger.tags = ['Building']
    #swagger.summary = 'Detail building (with its floors)'
    #swagger.parameters['id'] = { description: 'id building' }
  */
  try {
    const { id } = req.params;
    const data = await BuildingModel.findOne({
      _id: id,
      is_delete: { $ne: true },
    }).populate("branch_id", "name code");
    if (!data) throw new NotFound(`Data with id '${id}' not found!`);

    // Sertakan daftar lantai yang otomatis dibuat.
    const floors = await BuildingFloorModel.find({
      building_id: id,
      is_delete: { $ne: true },
    })
      .populate("floor_plan_url_id", "path")
      .sort({ floor_level: 1 });

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data: { ...data.toObject(), floors },
    });
  } catch (error) {
    next(error);
  }
};

controller.create = async (req, res, next) => {
  /*
    #swagger.tags = ['Building']
    #swagger.summary = 'Create building (auto-generates its floors)'
    #swagger.description = 'Code auto from name (ANGGREK -> AGRK). Each floor auto-created with code AGRK-FLR1.. and name Floor 1..'
    #swagger.parameters['obj'] = {
      in: 'body', description: 'Create building',
      schema: { $ref: '#/definitions/BodyBuildingSchema' }
    }
  */
  try {
    const payload = req.body;
    if (!payload?.branch_id) throw new BadRequest("branch_id is required.");
    if (!payload?.name) throw new BadRequest("Building name is required.");

    const totalFloors = Math.max(parseInt(payload.total_floors, 10) || 1, 1);

    const result = await runWithOptionalTransaction(async (session) => {
      const branch = await BranchModel.findOne({
        _id: payload.branch_id,
        is_delete: { $ne: true },
      }).session(session);
      if (!branch) throw new BadRequest("Branch not found.");

      const code = await ensureUniqueBuildingCode(payload.name, session);

      const [building] = await BuildingModel.create(
        [
          {
            branch_id: payload.branch_id,
            code,
            name: payload.name,
            building_type: payload.building_type,
            total_floors: totalFloors,
            building_area_sqm: payload.building_area_sqm,
            land_area_sqm: payload.land_area_sqm,
            address: payload.address,
            notes: payload.notes,
          },
        ],
        { session },
      );

      // Otomatis buat lantai sebanyak total_floors.
      const floorDocs = buildFloorDocs(building, 1, totalFloors);
      const floors = await BuildingFloorModel.create(floorDocs, {
        session,
        ordered: true,
      });

      await LogActionModel.create(
        [
          {
            target_id: building._id,
            source: BuildingModel.collection.collectionName,
            activities: [
              {
                type: "CREATE",
                after: building.toObject(),
                created_by: req?.login?.user_id ?? null,
              },
            ],
          },
        ],
        { session },
      );

      return { ...building.toObject(), floors };
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
    #swagger.tags = ['Building']
    #swagger.summary = 'Update building'
    #swagger.description = 'Bila total_floors dinaikkan, lantai baru otomatis ditambahkan.'
    #swagger.parameters['id'] = { description: 'id building' }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await BuildingModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new NotFound(`Data with id '${id}' not found!`);

      const before = doc.toObject();

      // Kode & slug stabil setelah dibuat — jangan ditimpa dari body.
      delete payload.code;
      delete payload.slug;

      // Bila total_floors dinaikkan, tambahkan lantai yang belum ada.
      if (payload.total_floors !== undefined) {
        const newTotal = Math.max(parseInt(payload.total_floors, 10) || 1, 1);
        const existingCount = await BuildingFloorModel.countDocuments({
          building_id: doc._id,
          is_delete: { $ne: true },
        }).session(session);

        if (newTotal > existingCount) {
          const floorDocs = buildFloorDocs(doc, existingCount + 1, newTotal);
          await BuildingFloorModel.create(floorDocs, {
            session,
            ordered: true,
          });
        }
        payload.total_floors = newTotal;
      }

      doc.set(payload);
      await doc.save({ session });

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: BuildingModel.collection.collectionName,
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
    #swagger.tags = ['Building']
    #swagger.summary = 'Delete building (soft delete, cascade to floors & rooms)'
    #swagger.parameters['id'] = { description: 'id building' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await BuildingModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new NotFound(`Data with id '${id}' not found!`);

      const before = doc.toObject();
      doc.is_delete = true;
      await doc.save({ session });

      // Cascade soft-delete: lantai & ruangan di dalam building ini.
      await BuildingFloorModel.updateMany(
        { building_id: id },
        { is_delete: true },
        { session },
      );
      await RoomUnitModel.updateMany(
        { building_id: id },
        { is_delete: true },
        { session },
      );

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: BuildingModel.collection.collectionName,
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

controller.uploadImage = async (req, res, next) => {
  /*
    #swagger.tags = ['Building']
    #swagger.summary = 'Upload building image (stored in Image model)'
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
