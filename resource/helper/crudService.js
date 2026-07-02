const { default: mongoose } = require("mongoose");
const logActionModel = require("../app/models/LogAction.model");

const crudServices = {};

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
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
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
    await session.commitTransaction();

    delete result.is_delete;
    delete result.updatedAt;
    return {
      success: true,
      message: "Data created successfully!",
      data: result,
    };
  } catch (error) {
    await session.abortTransaction();
    throw new Error(error.message);
  } finally {
    await session.endSession();
  }
};

// UPDATE
crudServices.update = async (model, { id, data }) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Ambil data lama dan dokumen log (tanpa .lean() pada log agar bisa di-save)
    const [dataOld, dLogAction] = await Promise.all([
      model.findById(id).lean().session(session),
      logActionModel.findOne({ target_id: id }).session(session),
    ]);

    if (!dataOld) throw new Error(`Data not found!`);

    // 2. Lakukan Update Data
    const dataUpdate = await model.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
      session,
    });

    // 3. Konversi Mongoose Document ke objek biasa agar propertinya bisa di-delete
    const dataUpdateObject = dataUpdate.toObject();
    delete dataUpdateObject.is_delete;
    delete dataUpdateObject.updatedAt;

    // 4. Update Log (Langsung push dan save karena dLogAction dipastikan ada)
    dLogAction.activities.push({
      type: "UPDATE",
      before: dataOld,
      after: dataUpdateObject,
    });

    await dLogAction.save({ session }); // Wajib pakai session agar masuk transaksi

    // 5. Commit Transaksi
    await session.commitTransaction();

    return {
      success: true,
      message: "Data updated successfully!",
      data: dataUpdate,
    };
  } catch (error) {
    await session.abortTransaction();
    throw new Error(error.message);
  } finally {
    await session.endSession();
  }
};

// DELETE
crudServices.delete = async (model, { id, data }) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Ambil data lama dan dokumen log (tanpa .lean() pada log agar bisa di-save)
    const [dExist, dLogAction] = await Promise.all([
      model.findById(id).lean().session(session),
      logActionModel.findOne({ target_id: id }).session(session),
    ]);

    if (!dExist) throw new Error(`Data not found!`);

    // 2. Lakukan Update Data
    const dataDelete = await model.findByIdAndUpdate(
      id,
      { is_delete: false },
      {
        new: true,
        runValidators: true,
        session,
      },
    );

    // 3. Konversi Mongoose Document ke objek biasa agar propertinya bisa di-delete
    const dataUpdateObject = dataDelete.toObject();
    delete dataUpdateObject.is_delete;
    delete dataUpdateObject.updatedAt;

    // 4. Update Log (Langsung push dan save karena dLogAction dipastikan ada)
    dLogAction.activities.push({
      type: "DELETE",
      before: dExist,
      after: dataUpdateObject,
    });

    await dLogAction.save({ session }); // Wajib pakai session agar masuk transaksi

    // 5. Commit Transaksi
    await session.commitTransaction();

    return {
      success: true,
      message: "Data updated successfully!",
      data: dataDelete,
    };
  } catch (error) {
    await session.abortTransaction();
    throw new Error(error.message);
  } finally {
    await session.endSession();
  }
};

module.exports = crudServices;
