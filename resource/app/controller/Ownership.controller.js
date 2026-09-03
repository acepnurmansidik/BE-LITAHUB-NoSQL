const { runWithOptionalTransaction } = require("../../helper/crudService");
const BadRequest = require("../../utils/errors/bad-request");
const NotFound = require("../../utils/errors/not-found");
const LogActionModel = require("../models/LogAction.model");
const UnitModel = require("../models/Unit.model");
const UserModel = require("../models/users.model");
const OwnershipModel = require("../models/Ownership.model");

const controller = {};
const source = OwnershipModel.collection.collectionName;

const OWNERSHIP_TYPES = ["OWNER", "TENANT"];
const normalizeType = (v) => {
  const t = String(v ?? "").toUpperCase();
  return OWNERSHIP_TYPES.includes(t) ? t : "OWNER";
};

// Ambil unit (aktif & belum terhapus). Melempar NotFound bila tak ditemukan.
const resolveUnit = async (unitId, session) => {
  if (!unitId) throw new BadRequest("Field 'unit_id' is required!");
  const unit = await UnitModel.findOne({
    _id: unitId,
    is_delete: { $ne: true },
  }).session(session ?? null);
  if (!unit) throw new NotFound(`Unit '${unitId}' not found`);
  return unit;
};

// Ambil user pemilik (aktif & belum terhapus). owner_name diambil dari user ini.
const resolveUser = async (userId, session) => {
  if (!userId) throw new BadRequest("Field 'user_ownership_id' is required!");
  const user = await UserModel.findOne({
    _id: userId,
    is_delete: { $ne: true },
  }).session(session ?? null);
  if (!user) throw new NotFound(`User '${userId}' not found`);
  return user;
};

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['Ownership']
    #swagger.summary = 'List Ownership'
    #swagger.description = 'Retrieve a paginated list of unit ownership records.'
    #swagger.parameters['search'] = { default: '', description: 'search by owner/unit name' }
    #swagger.parameters['unit_id'] = { default: '', description: 'filter by unit id' }
    #swagger.parameters['limit'] = { default: 10, description: 'limit' }
    #swagger.parameters['page'] = { default: 1, description: 'page' }
  */
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { search, unit_id } = req.query;

    const query = { is_delete: { $ne: true } };
    if (unit_id) query.unit_id = unit_id;
    if (search) {
      query["$or"] = [
        { owner_name: { $regex: search, $options: "i" } },
        { unit_name: { $regex: search, $options: "i" } },
      ];
    }

    const [data, total] = await Promise.all([
      OwnershipModel.find(query)
        .populate("unit_id", "code name")
        .populate("user_ownership_id", "name")
        .sort({ _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      OwnershipModel.countDocuments(query),
    ]);

    res.status(200).json({
      status: 200,
      message: "Data retrieved successfully",
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
    #swagger.tags = ['Ownership']
    #swagger.summary = 'Get Ownership'
    #swagger.parameters['id'] = { description: 'id Ownership' }
  */
  try {
    const { id } = req.params;
    const data = await OwnershipModel.findOne({
      _id: id,
      is_delete: { $ne: true },
    })
      .populate("unit_id", "code name")
      .populate("user_ownership_id", "name");
    if (!data) throw new NotFound(`data with id '${id}' not found!`);

    res
      .status(200)
      .json({ success: true, message: "Data retrieved successfully!", data });
  } catch (error) {
    next(error);
  }
};

controller.create = async (req, res, next) => {
  /*
    #swagger.tags = ['Ownership']
    #swagger.summary = 'Create Ownership'
    #swagger.description = 'Create a new unit ownership record.'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create Ownership',
      schema: { $ref: '#/definitions/BodyOwnershipSchema' }
    }
  */
  try {
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const [unit, user] = await Promise.all([
        resolveUnit(payload.unit_id, session),
        resolveUser(payload.user_ownership_id, session),
      ]);

      // Unit yang sudah RESERVED tidak boleh dipilih lagi.
      if (String(unit.status).toUpperCase() === "RESERVED")
        throw new BadRequest(
          `Unit '${unit.name || unit.code}' is already reserved!`,
        );

      payload.unit_name = payload.unit_name || unit.name || unit.code || "";
      // owner_name selalu diambil dari nama User (bukan dari client).
      payload.owner_name = user.name;
      payload.ownership_type = normalizeType(payload.ownership_type);
      payload.created_by = req?.login?.user_id ?? null;

      const [data] = await OwnershipModel.create([payload], { session });

      // Unit otomatis menjadi RESERVED begitu kepemilikannya dibuat.
      unit.status = "RESERVED";
      await unit.save({ session });

      await LogActionModel.create(
        [
          {
            target_id: data._id,
            source,
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

    res
      .status(201)
      .json({ success: true, message: "Data has been created!", data: result });
  } catch (error) {
    next(error);
  }
};

controller.update = async (req, res, next) => {
  /*
    #swagger.tags = ['Ownership']
    #swagger.summary = 'Update Ownership'
    #swagger.description = 'Update an existing unit ownership record.'
    #swagger.parameters['id'] = { description: 'id Ownership' }
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Update Ownership',
      schema: { $ref: '#/definitions/BodyOwnershipSchema' }
    }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await OwnershipModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      });
      if (!doc) throw new NotFound(`Data with id '${id}' not found`);

      const before = doc.toObject();

      // Bila unit diganti: validasi unit baru (tidak boleh RESERVED), lepas unit
      // lama (kembali AVAILABLE) & tandai unit baru RESERVED.
      if (payload.unit_id && String(payload.unit_id) !== String(doc.unit_id)) {
        const unit = await resolveUnit(payload.unit_id, session);
        if (String(unit.status).toUpperCase() === "RESERVED")
          throw new BadRequest(
            `Unit '${unit.name || unit.code}' is already reserved!`,
          );
        payload.unit_name = payload.unit_name || unit.name || unit.code || "";

        // Lepas unit lama -> AVAILABLE.
        const oldUnit = await UnitModel.findOne({
          _id: doc.unit_id,
          is_delete: { $ne: true },
        }).session(session ?? null);
        if (oldUnit) {
          oldUnit.status = "AVAILABLE";
          await oldUnit.save({ session });
        }

        // Tandai unit baru -> RESERVED.
        unit.status = "RESERVED";
        await unit.save({ session });
      }
      // Bila user pemilik diganti, validasi & sinkronkan owner_name dari User.
      if (
        payload.user_ownership_id &&
        String(payload.user_ownership_id) !== String(doc.user_ownership_id)
      ) {
        const user = await resolveUser(payload.user_ownership_id, session);
        payload.owner_name = user.name;
      } else {
        // owner_name tidak boleh diubah manual dari client.
        delete payload.owner_name;
      }
      if (payload.ownership_type !== undefined) {
        payload.ownership_type = normalizeType(payload.ownership_type);
      }
      // created_by tidak boleh ditimpa dari client.
      delete payload.created_by;

      doc.set(payload);
      await doc.save({ session });

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: { target_id: id, source },
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

    res
      .status(200)
      .json({ success: true, message: "Data has been updated!", data: result });
  } catch (error) {
    next(error);
  }
};

controller.delete = async (req, res, next) => {
  /*
    #swagger.tags = ['Ownership']
    #swagger.summary = 'Delete Ownership'
    #swagger.description = 'Soft-delete an existing unit ownership record.'
    #swagger.parameters['id'] = { description: 'id Ownership' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await OwnershipModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      });
      if (!doc) throw new NotFound(`Data with id '${id}' not found`);

      const before = doc.toObject();

      doc.is_delete = true;
      await doc.save({ session });

      // Kepemilikan dihapus -> unit kembali AVAILABLE.
      const unit = await UnitModel.findOne({
        _id: doc.unit_id,
        is_delete: { $ne: true },
      }).session(session ?? null);
      if (unit) {
        unit.status = "AVAILABLE";
        await unit.save({ session });
      }

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: { target_id: id, source },
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

    res
      .status(200)
      .json({ success: true, message: "Data has been deleted!", data: result });
  } catch (error) {
    next(error);
  }
};

module.exports = controller;
