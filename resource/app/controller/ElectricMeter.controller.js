const { runWithOptionalTransaction } = require("../../helper/crudService");
const { generateSequenceNo } = require("../../helper/sequence");
const globalService = require("../../helper/global-func");
const BadRequest = require("../../utils/errors/bad-request");
const NotFound = require("../../utils/errors/not-found");
const LogActionModel = require("../models/LogAction.model");
const UnitModel = require("../models/Unit.model");
const ImageModel = require("../models/Image.model");
const ElectricMeterModel = require("../models/ElectricMeter.model");

const controller = {};
const source = ElectricMeterModel.collection.collectionName;

// prev_meter untuk sebuah unit = current_meter dari pencatatan TERAKHIR unit itu
// (berdasarkan tanggal). 0 bila belum pernah ada. `excludeId` mengabaikan
// dokumen sendiri saat update.
const resolvePrevMeter = async (unitId, excludeId, session) => {
  const query = { unit_id: unitId, is_delete: { $ne: true } };
  if (excludeId) query._id = { $ne: excludeId };
  const last = await ElectricMeterModel.findOne(query)
    .sort({ date: -1, _id: -1 })
    .session(session ?? null)
    .lean();
  return last?.current_meter ?? 0;
};

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['Electric']
    #swagger.summary = 'List Electric'
    #swagger.description = 'Retrieve a paginated list of Electric with their access modules and path access.'
    #swagger.parameters['search'] = { default: '', description: 'search by value' }
    #swagger.parameters['month'] = { default: '', description: 'filter by month (1-12)' }
    #swagger.parameters['year'] = { default: '', description: 'filter by year (e.g. 2026)' }
    #swagger.parameters['limit'] = { default: 10, description: 'limit' }
    #swagger.parameters['page'] = { default: 1, description: 'page' }
  */
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { search, month, year } = req.query;

    const query = { is_delete: { $ne: true } };
    if (search) {
      query["$or"] = [
        { electricity_no: { $regex: search, $options: "i" } },
        { unit_name: { $regex: search, $options: "i" } },
      ];
    }

    // Filter bulan & tahun (dari menu misc > filter, hanya bulan & tahun).
    const range = globalService.monthYearRange(month, year);
    if (range) query.date = { $gte: range.start, $lt: range.end };

    const [data, total] = await Promise.all([
      ElectricMeterModel.find(query)
        .populate("unit_id", "code name")
        .populate("image_id", "path")
        .sort({ _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ElectricMeterModel.countDocuments(query),
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

controller.prevMeter = async (req, res, next) => {
  /*
    #swagger.tags = ['Electric']
    #swagger.summary = 'Get previous meter for a unit'
    #swagger.description = 'Return the last recorded current_meter for a unit (0 if none). Used to prefill prev_meter on the form.'
    #swagger.parameters['unit_id'] = { default: '', description: 'unit id' }
  */
  try {
    const { unit_id } = req.query;
    if (!unit_id) throw new BadRequest(`Query 'unit_id' is required!`);

    const prev_meter = await resolvePrevMeter(unit_id, null, null);
    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data: { prev_meter },
    });
  } catch (error) {
    next(error);
  }
};

controller.show = async (req, res, next) => {
  /*
    #swagger.tags = ['Electric']
    #swagger.summary = 'Get Electric'
    #swagger.parameters['id'] = { description: 'id Electric' }
  */
  try {
    const { id } = req.params;

    const data = await ElectricMeterModel.findOne({
      _id: id,
      is_delete: { $ne: true },
    }).populate("image_id", "path");
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
    #swagger.tags = ['Electric']
    #swagger.summary = 'Create Electric'
    #swagger.description = 'Create a new Electric meter record.'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create Electric',
      schema: { $ref: '#/definitions/BodyElectricMeterSchema' }
    }
  */
  try {
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const range = globalService.monthRange(payload.date);
      if (!range) throw new BadRequest(`Field 'date' is invalid!`);

      const currentMeter = Number(payload.current_meter);
      if (
        payload.current_meter === undefined ||
        payload.current_meter === null ||
        payload.current_meter === "" ||
        Number.isNaN(currentMeter)
      )
        throw new BadRequest(`Field 'current_meter' must be a number!`);

      const [unit, duplicate, image] = await Promise.all([
        UnitModel.findOne({ _id: payload.unit_id, is_delete: { $ne: true } }),
        // Duplicate check: same unit within the same month.
        ElectricMeterModel.findOne({
          unit_id: payload.unit_id,
          date: { $gte: range.start, $lt: range.end },
          is_delete: { $ne: true },
        }),
        payload.image_id
          ? ImageModel.findOne({ _id: payload.image_id }).lean()
          : null,
      ]);

      if (!unit) throw new NotFound(`Unit '${payload.unit_name}' not found`);
      if (duplicate)
        throw new BadRequest(
          `Electric meter data for this unit already exists for the selected month!`,
        );
      // Gambar tidak valid -> abaikan.
      if (!image) payload.image_id = null;

      // Hitung ulang di server: prev = current_meter terakhir unit, usage = selisih.
      const prevMeter = await resolvePrevMeter(payload.unit_id, null, session);
      if (currentMeter < prevMeter)
        throw new BadRequest(
          `'current_meter' (${currentMeter}) must be greater than or equal to the previous meter (${prevMeter})!`,
        );
      payload.prev_meter = prevMeter;
      payload.current_meter = currentMeter;
      payload.usage_meter = currentMeter - prevMeter;
      // actual_meter diset hanya di backend, diambil dari usage_meter.
      payload.actual_meter = payload.usage_meter;
      payload.electricity_no = await generateSequenceNo({
        module: source,
        prefix: `ELC.${unit.name}`,
        date: payload.date,
        session,
      });

      const [data] = await ElectricMeterModel.create([payload], { session });

      // Tandai gambar terpilih sebagai dipakai (status = true).
      await globalService.setImageStatus(data.image_id, true, session);

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
    #swagger.tags = ['Electric']
    #swagger.summary = 'Update Electric'
    #swagger.description = 'Update an existing Electric meter record.'
    #swagger.parameters['id'] = { description: 'id Electric' }
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Update Electric',
      schema: { $ref: '#/definitions/BodyElectricMeterSchema' }
    }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await ElectricMeterModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      });
      if (!doc) throw new NotFound(`Data with id '${id}' not found`);

      // Effective values after update: use the payload when provided, otherwise
      // keep the existing values.
      const effectiveDate = payload.date ?? doc.date;
      const effectiveUnitId = payload.unit_id ?? doc.unit_id;

      const range = globalService.monthRange(effectiveDate);
      if (!range) throw new BadRequest(`Field 'date' is invalid!`);

      const [unit, duplicate] = await Promise.all([
        UnitModel.findOne({ _id: effectiveUnitId, is_delete: { $ne: true } }),
        // Duplicate check: same unit within the same month, EXCLUDING this doc.
        ElectricMeterModel.findOne({
          _id: { $ne: id },
          unit_id: effectiveUnitId,
          date: { $gte: range.start, $lt: range.end },
          is_delete: { $ne: true },
        }),
      ]);

      if (!unit) throw new NotFound(`Unit '${payload.unit_name}' not found`);
      if (duplicate)
        throw new BadRequest(
          `Electric meter data for this unit already exists for the selected month!`,
        );

      const before = doc.toObject();

      // Hitung ulang meter di server (validasi).
      const currentMeter =
        payload.current_meter === undefined ||
        payload.current_meter === null ||
        payload.current_meter === ""
          ? doc.current_meter
          : Number(payload.current_meter);
      if (Number.isNaN(currentMeter))
        throw new BadRequest(`Field 'current_meter' must be a number!`);

      const prevMeter = await resolvePrevMeter(effectiveUnitId, id, session);
      if (currentMeter < prevMeter)
        throw new BadRequest(
          `'current_meter' (${currentMeter}) must be greater than or equal to the previous meter (${prevMeter})!`,
        );
      payload.prev_meter = prevMeter;
      payload.current_meter = currentMeter;
      payload.usage_meter = currentMeter - prevMeter;
      // actual_meter diset hanya di backend, diambil dari usage_meter.
      payload.actual_meter = payload.usage_meter;

      // Bila gambar diganti: nonaktifkan gambar lama, aktifkan gambar baru.
      // Bila id gambar baru tidak valid -> pertahankan gambar lama.
      const prevImageId = doc.image_id ? String(doc.image_id) : null;
      let nextImageId =
        payload.image_id !== undefined
          ? payload.image_id
            ? String(payload.image_id)
            : null
          : prevImageId;
      if (prevImageId !== nextImageId) {
        const checkNewImage = nextImageId
          ? await ImageModel.findOne({ _id: nextImageId }).lean()
          : null;
        if (nextImageId && !checkNewImage) nextImageId = prevImageId;
        payload.image_id = nextImageId;
        if (prevImageId !== nextImageId) {
          await globalService.setImageStatus(prevImageId, false, session);
          await globalService.setImageStatus(nextImageId, true, session);
        }
      }

      delete payload.electricity_no;
      doc.set(payload);
      await doc.save({ session });

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source,
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

    res
      .status(200)
      .json({ success: true, message: "Data has been updated!", data: result });
  } catch (error) {
    next(error);
  }
};

controller.delete = async (req, res, next) => {
  /*
    #swagger.tags = ['Electric']
    #swagger.summary = 'Delete Electric'
    #swagger.description = 'Soft-delete an existing Electric meter record.'
    #swagger.parameters['id'] = { description: 'id Electric' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await ElectricMeterModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      });

      if (!doc) throw new NotFound(`Data with id '${id}' not found`);
      const before = doc.toObject();

      doc.is_delete = true;
      await doc.save({ session });

      // Lepas gambar (status = false) saat data dihapus.
      await globalService.setImageStatus(doc.image_id, false, session);

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source,
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
    res
      .status(200)
      .json({ success: true, message: "Data has been deleted!", data: result });
  } catch (error) {
    next(error);
  }
};

module.exports = controller;
