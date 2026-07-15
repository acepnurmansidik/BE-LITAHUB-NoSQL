const { default: mongoose } = require("mongoose");
const logActionModel = require("../app/models/LogAction.model");

const crudServices = {};

// Deteksi error MongoDB "transaction tidak didukung" (server standalone,
// bukan replica set / sharded cluster).
const isTransactionUnsupported = (error) => {
  const msg = error?.message || "";
  return (
    error?.code === 20 ||
    error?.code === 263 ||
    /Transaction numbers are only allowed/i.test(msg) ||
    /sharded cluster can start a new transaction/i.test(msg) ||
    /replica set member or mongos/i.test(msg)
  );
};

// Cek label error MongoDB (driver menaruh label di error.errorLabels /
// error.hasErrorLabel()).
const hasErrorLabel = (error, label) => {
  if (typeof error?.hasErrorLabel === "function") {
    return error.hasErrorLabel(label);
  }
  return Array.isArray(error?.errorLabels) && error.errorLabels.includes(label);
};

// Error transaksi yang sifatnya sementara dan disarankan untuk di-retry
// (mis. konflik catalog saat collection dibuat, write conflict).
const isRetryableTransactionError = (error) => {
  const msg = error?.message || "";
  return (
    hasErrorLabel(error, "TransientTransactionError") ||
    hasErrorLabel(error, "UnknownTransactionCommitResult") ||
    /please retry/i.test(msg) ||
    /catalog changes/i.test(msg) ||
    /WriteConflict/i.test(msg)
  );
};

// Jalankan `work(session)` di dalam transaction. Perilaku:
//  - Server tidak mendukung transaction (standalone) -> ulangi tanpa session.
//  - Error transaksi sementara (TransientTransactionError, konflik catalog)
//    -> retry seluruh transaksi hingga `maxRetries` kali.
const runWithOptionalTransaction = async (work, maxRetries = 5) => {
  const session = await mongoose.startSession();
  try {
    let attempt = 0;
    while (true) {
      attempt += 1;
      try {
        session.startTransaction();
        const result = await work(session);
        await session.commitTransaction();
        return result;
      } catch (error) {
        try {
          if (session.inTransaction()) await session.abortTransaction();
        } catch (_) {
          /* abaikan: transaksi mungkin belum aktif */
        }

        if (isTransactionUnsupported(error)) {
          return work(null);
        }
        if (isRetryableTransactionError(error) && attempt < maxRetries) {
          continue; // ulangi seluruh transaksi
        }
        throw new Error(error.message);
      }
    }
  } finally {
    await session.endSession();
  }
};

// FIND BY ID
crudServices.findOneById = async (
  model,
  { id, populateField, selectField },
) => {
  try {
    const result = await model
      .findOne({ _id: id, is_delete: { $ne: true } })
      .populate(populateField)
      .select(`${selectField ?? ""} -__v -updatedAt -is_delete`)
      .lean();

    if (!result) throw new Error(`data with id: '${id}' not found!`);

    return {
      success: true,
      message: "Data retrieved successfully!",
      data: result,
    };
  } catch (error) {
    throw new Error(error.message);
  }
};

// FINDONE
crudServices.findOne = async (model, { query, populateField, selectField }) => {
  try {
    const result = await model
      .findOne({ ...query, is_delete: { $ne: true } })
      .populate(populateField)
      .select(`${selectField ?? ""} -__v -updatedAt -is_delete`);

    return {
      success: true,
      message: "Data retrieved successfully!",
      data: result,
    };
  } catch (error) {
    throw new Error(error.message);
  }
};

// FIND ALL
crudServices.findAll = async (
  model,
  { query, populateField, selectField = "" },
) => {
  try {
    const result = await model
      .find({ ...query, is_delete: { $ne: true } }, {})
      .populate(populateField)
      .select(`${selectField} -updatedAt -is_delete`)
      .sort({ _id: -1 });

    return {
      success: true,
      message: "Data retrieved successfully!",
      data: result,
    };
  } catch (error) {
    throw new Error(error.message);
  }
};

// FIND ALL
crudServices.findAllPagination = async (
  model,
  { query, populateField, selectField = "", skip, limit = 10 },
) => {
  try {
    const result = await model
      .find({ ...query, is_delete: { $ne: true } }, {})
      .populate(populateField)
      .select(`${selectField} -updated_at -is_delete`)
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit);

    return {
      success: true,
      message: "Data retrieved successfully!",
      data: result,
    };
  } catch (error) {
    throw new Error(error.message);
  }
};

// CREATE
crudServices.create = async (model, { data }) => {
  return runWithOptionalTransaction(async (session) => {
    const [result] = await model.create([data], { session });

    const log = {
      target_id: result._id, // id of the created document
      source: model.collection.collectionName,
      activities: [
        {
          type: "CREATE",
          after: result,
        },
      ],
    };

    await logActionModel.create([log], { session });

    delete result.is_delete;
    delete result.updatedAt;
    return {
      success: true,
      message: "Data created successfully!",
      data: result,
    };
  });
};

// UPDATE
crudServices.update = async (model, { id, data }) => {
  return runWithOptionalTransaction(async (session) => {
    // 1. Ambil data lama dan dokumen log (tanpa .lean() pada log agar bisa di-save)
    const [dataOld, dLogAction] = await Promise.all([
      model.findById(id).lean().session(session),
      logActionModel.findOne({ target_id: id }).session(session),
    ]);

    if (!dataOld) throw new Error(`Data not found!`);

    // 2. Lakukan Update Data
    const dataUpdate = await model.findByIdAndUpdate(id, data, {
      returnDocument: "after",
      runValidators: true,
      session,
    });

    // 3. Konversi Mongoose Document ke objek biasa agar propertinya bisa di-delete
    const dataUpdateObject = dataUpdate.toObject();
    delete dataUpdateObject.is_delete;
    delete dataUpdateObject.updatedAt;

    // 4. Update Log. Jika log belum ada (mis. data dari seeder), buat baru;
    //    jika sudah ada, cukup push activity dan simpan.
    const activity = {
      type: "UPDATE",
      before: dataOld,
      after: dataUpdateObject,
    };

    if (dLogAction) {
      dLogAction.activities.push(activity);
      await dLogAction.save({ session }); // Wajib pakai session agar masuk transaksi
    } else {
      await logActionModel.create(
        [
          {
            target_id: id,
            source: model.collection.collectionName,
            activities: [activity],
          },
        ],
        { session },
      );
    }

    return {
      success: true,
      message: "Data updated successfully!",
      data: dataUpdate,
    };
  });
};

// DELETE
crudServices.delete = async (model, { id, data }) => {
  return runWithOptionalTransaction(async (session) => {
    // 1. Ambil data lama dan dokumen log (tanpa .lean() pada log agar bisa di-save)
    const [dExist, dLogAction] = await Promise.all([
      model.findById(id).lean().session(session),
      logActionModel.findOne({ target_id: id }).session(session),
    ]);

    if (!dExist) throw new Error(`Data not found!`);

    // 2. Lakukan Update Data
    const dataDelete = await model.findByIdAndUpdate(
      id,
      { is_delete: true },
      {
        returnDocument: "after",
        runValidators: true,
        session,
      },
    );

    // 3. Konversi Mongoose Document ke objek biasa agar propertinya bisa di-delete
    const dataUpdateObject = dataDelete.toObject();
    delete dataUpdateObject.is_delete;
    delete dataUpdateObject.updatedAt;

    const activity = {
      type: "DELETE",
      before: dExist,
      after: dataUpdateObject,
    };

    if (dLogAction) {
      dLogAction.activities.push(activity);
      await dLogAction.save({ session }); // Wajib pakai session agar masuk transaksi
    } else {
      await logActionModel.create(
        [
          {
            target_id: id,
            source: model.collection.collectionName,
            activities: [activity],
          },
        ],
        { session },
      );
    }

    return {
      success: true,
      message: "Data updated successfully!",
      data: dataDelete,
    };
  });
};

// Diekspor agar controller yang butuh alur multi-collection (mis. Role)
// dapat memakai transaction + fallback yang sama.
crudServices.runWithOptionalTransaction = runWithOptionalTransaction;

module.exports = crudServices;
