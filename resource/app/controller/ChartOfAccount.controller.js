const crudServices = require("../../helper/crudService");
const ChartOfAccountModel = require("../models/ChartOfAccount.model");
const BadRequest = require("../../utils/errors/bad-request");
const LogActionModel = require("../models/LogAction.model");

const controller = {};

const { runWithOptionalTransaction } = crudServices;

// Peta tipe akun → saldo normal (DEBIT/CREDIT). Tipe dasar mengikuti kaidah
// akuntansi (ASSET/EXPENSE = DEBIT); tipe tambahan (kategori laporan) diberi
// saldo normal eksplisit karena tak lagi bisa ditebak dari namanya:
//   - biaya/beban (COGS, ADM_OPERATION_EXPENSE, DEPRECIATION_AMORTIZATION) DEBIT
//   - pendapatan/modal (SALES, CAPITAL, OTHER_INCOME_EXPENSE) CREDIT
//   - OTHERS default DEBIT (bisa disesuaikan kebutuhan).
const NORMAL_BALANCE_BY_TYPE = {
  ASSET: "DEBIT",
  LIABILITY: "CREDIT",
  EQUITY: "CREDIT",
  REVENUE: "CREDIT",
  EXPENSE: "DEBIT",
  CAPITAL: "CREDIT",
  SALES: "CREDIT",
  COGS: "DEBIT",
  OTHER_INCOME_EXPENSE: "CREDIT",
  ADM_OPERATION_EXPENSE: "DEBIT",
  DEPRECIATION_AMORTIZATION: "DEBIT",
  OTHERS: "DEBIT",
};

const ACCOUNT_TYPES = Object.keys(NORMAL_BALANCE_BY_TYPE);

const normalBalanceFor = (type) => NORMAL_BALANCE_BY_TYPE[type] ?? "DEBIT";

// Susun path & level dari induk. Induk WAJIB berupa header (is_header) — hanya
// akun grup yang boleh memiliki anak. Mengembalikan { parent, level, path,type }.
const resolveParent = async (parentId, code, session) => {
  if (!parentId) {
    return { parent: null, level: 1, path: code };
  }

  const parent = await ChartOfAccountModel.findOne({
    _id: parentId,
    is_delete: { $ne: true },
  }).session(session ?? null);

  if (!parent) throw new BadRequest("Parent account not found!");
  if (!parent.is_header) {
    throw new BadRequest(
      "Parent account must be a header (only headers can have children).",
    );
  }

  return {
    parent,
    level: parent.level + 1,
    path: `${parent.path}.${code}`,
    type: parent.type,
  };
};

// Pastikan kode unik (mengabaikan dokumen tertentu saat update).
const assertCodeUnique = async (code, session, exceptId = null) => {
  const query = { code, is_delete: { $ne: true } };
  if (exceptId) query._id = { $ne: exceptId };
  const exists = await ChartOfAccountModel.findOne(query).session(
    session ?? null,
  );
  if (exists) throw new BadRequest(`Account code "${code}" already exists.`);
};

// Cascade perubahan path/level ke seluruh turunan saat kode/parent akun berubah.
// Turunan dikenali dari prefix path lama (`${oldPath}.`). Karena `code` === path
// (kode induk selalu menjadi prefix), kode turunan ikut ditulis ulang agar
// prefix tetap sinkron sampai ke bawah.
const cascadeDescendants = async (oldPath, newPath, levelDelta, session) => {
  if (oldPath === newPath && levelDelta === 0) return;

  const descendants = await ChartOfAccountModel.find({
    path: { $regex: `^${oldPath}\\.` },
    is_delete: { $ne: true },
  }).session(session ?? null);

  for (const node of descendants) {
    node.path = `${newPath}${node.path.slice(oldPath.length)}`;
    node.code = node.path;
    node.level = node.level + levelDelta;
    await node.save({ session });
  }
};

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['CHART OF ACCOUNT']
    #swagger.summary = 'Chart of Account'
    #swagger.description = 'Master COA berhierarki tak terbatas dalam satu collection'
    #swagger.parameters['search'] = { default: '', description: 'search by name / code' }
  */
  try {
    const { search, is_header } = req.query;
    const query = { is_delete: { $ne: true } };

    if (is_header) query.is_header = is_header;

    if (search) {
      query["$or"] = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
      ];
    }

    // COA ditampilkan sebagai pohon di client, jadi kirim SELURUH node yang
    // cocok (diurutkan berdasarkan path) tanpa pagination — client menyusun
    // hierarki dari parent_id.
    const data = await ChartOfAccountModel.find({
      ...query,
      is_delete: { $ne: true },
    })
      .sort({ path: 1 })
      .select("-is_delete");

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: data.length,
      current_page: 1,
    });
  } catch (err) {
    next(err);
  }
};

controller.create = async (req, res, next) => {
  /*
    #swagger.tags = ['CHART OF ACCOUNT']
    #swagger.summary = 'Chart of Account'
    #swagger.description = 'Buat akun COA baru (root atau anak dari header)'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create chart of account',
      schema: { $ref: '#/definitions/BodyChartOfAccountSchema' }
    }
  */
  try {
    const payload = req.body;

    // `payload.code` = SEGMEN LOKAL (bagian yang diketik user). Kode akun final
    // = materialized path: kode induk otomatis menjadi prefix (mis. induk
    // "1000" + segmen "123" → "1000.123"), berlaku berjenjang sampai ke bawah.
    const localCode = String(payload.code ?? "").trim();
    const name = String(payload.name ?? "").trim();
    if (!localCode) throw new BadRequest("Account code is required!");
    if (localCode.includes(".")) {
      throw new BadRequest("Account code segment cannot contain a dot (.).");
    }
    if (!name) throw new BadRequest("Account name is required!");

    const isHeader = payload.is_header === true;
    const parentId = payload.parent_id || null;

    const result = await runWithOptionalTransaction(async (session) => {
      const {
        parent,
        level,
        path,
        type: parentType,
      } = await resolveParent(parentId, localCode, session);

      // Kode final = path (kode induk sebagai prefix). Untuk akun root, kode
      // final sama dengan segmen yang diketik.
      const code = path;
      await assertCodeUnique(code, session);

      // Anak mewarisi type dari induk agar konsisten; akun root memakai type
      // dari payload (harus salah satu ACCOUNT_TYPES).
      const type = parent
        ? parentType
        : String(payload.type ?? "").toUpperCase();
      if (!ACCOUNT_TYPES.includes(type)) {
        throw new BadRequest(
          `Account type must be one of: ${ACCOUNT_TYPES.join(", ")}.`,
        );
      }

      const [account] = await ChartOfAccountModel.create(
        [
          {
            code,
            name,
            type,
            normal_balance: normalBalanceFor(type),
            is_header: isHeader,
            parent_id: parent ? parent._id : null,
            level,
            path,
            description: payload.description ?? "",
          },
        ],
        { session },
      );

      await LogActionModel.create(
        [
          {
            target_id: account._id,
            source: ChartOfAccountModel.collection.collectionName,
            activities: [{ type: "CREATE", after: account.toObject() }],
          },
        ],
        { session },
      );

      return account;
    });

    res.status(201).json({
      code: 201,
      success: true,
      message: "Chart of account created successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.update = async (req, res, next) => {
  /*
    #swagger.tags = ['CHART OF ACCOUNT']
    #swagger.summary = 'Chart of Account'
    #swagger.description = 'Perbarui akun COA (termasuk pindah induk / ubah kode)'
    #swagger.parameters['id'] = { description: 'id chart of account' }
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Update chart of account',
      schema: { $ref: '#/definitions/BodyChartOfAccountSchema' }
    }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const account = await ChartOfAccountModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!account) throw new BadRequest("Data not found!");

      const before = account.toObject();
      const oldPath = account.path;
      const oldLevel = account.level;

      // Jumlah anak aktif — dipakai untuk validasi header & pemindahan.
      const childCount = await ChartOfAccountModel.countDocuments({
        parent_id: account._id,
        is_delete: { $ne: true },
      }).session(session);

      if (payload.name !== undefined)
        account.name = String(payload.name).trim();
      if (payload.description !== undefined) {
        account.description = payload.description;
      }

      // Header tidak boleh dimatikan bila masih punya anak.
      if (payload.is_header !== undefined) {
        const nextHeader = payload.is_header === true;
        if (!nextHeader && childCount > 0) {
          throw new BadRequest(
            "Cannot unset header: account still has child accounts.",
          );
        }
        account.is_header = nextHeader;
      }

      // Segmen lokal kode (bagian setelah prefix induk). `payload.code` berisi
      // segmen lokal yang diketik user; bila tak dikirim, pakai segmen saat ini
      // (potongan terakhir dari path/kode berjalan).
      const currentLocal = account.code.includes(".")
        ? account.code.slice(account.code.lastIndexOf(".") + 1)
        : account.code;
      const localCode =
        payload.code !== undefined ? String(payload.code).trim() : currentLocal;
      if (!localCode) throw new BadRequest("Account code is required!");
      if (localCode.includes(".")) {
        throw new BadRequest("Account code segment cannot contain a dot (.).");
      }

      // Induk efektif: yang dikirim, atau tetap induk lama.
      const parentProvided = payload.parent_id !== undefined;
      const nextParentId = parentProvided
        ? payload.parent_id || null
        : account.parent_id;

      // Tidak boleh menjadikan diri sendiri sebagai induk (siklus).
      if (String(nextParentId) === String(account._id)) {
        throw new BadRequest("An account cannot be its own parent.");
      }

      // Susun ulang path/level/kode dari induk efektif + segmen lokal. Kode
      // final = path (prefix induk otomatis, berjenjang sampai ke bawah).
      const {
        parent,
        level,
        path,
        type: parentType,
      } = await resolveParent(nextParentId, localCode, session);
      if (parent && parent.path.startsWith(`${oldPath}.`)) {
        throw new BadRequest(
          "Cannot move an account under one of its own descendants.",
        );
      }

      account.parent_id = parent ? parent._id : null;
      account.level = level;
      account.path = path;
      if (path !== account.code) {
        await assertCodeUnique(path, session, account._id);
      }
      account.code = path;

      if (parent) {
        // Anak mewarisi type dari induk.
        account.type = parentType;
        account.normal_balance = normalBalanceFor(parentType);
      } else if (payload.type !== undefined) {
        // Ubah type hanya untuk akun ROOT.
        const nextType = String(payload.type).toUpperCase();
        if (!ACCOUNT_TYPES.includes(nextType)) {
          throw new BadRequest(
            `Account type must be one of: ${ACCOUNT_TYPES.join(", ")}.`,
          );
        }
        account.type = nextType;
        account.normal_balance = normalBalanceFor(nextType);
      }

      await account.save({ session });

      // Cascade path/level ke turunan bila berubah.
      await cascadeDescendants(
        oldPath,
        account.path,
        account.level - oldLevel,
        session,
      );

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: ChartOfAccountModel.collection.collectionName,
          },
          $push: {
            activities: {
              type: "UPDATE",
              before,
              after: account.toObject(),
              created_by: req?.login?.user_id ?? null,
            },
          },
        },
        { upsert: true, session },
      );

      return account;
    });

    res.status(200).json({
      code: 200,
      success: true,
      message: "Chart of account updated successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.delete = async (req, res, next) => {
  /*
    #swagger.tags = ['CHART OF ACCOUNT']
    #swagger.summary = 'Chart of Account'
    #swagger.description = 'Hapus akun COA (soft delete). Ditolak bila masih punya anak.'
    #swagger.parameters['id'] = { description: 'id chart of account' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const account = await ChartOfAccountModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!account) throw new BadRequest("Data not found!");

      const childCount = await ChartOfAccountModel.countDocuments({
        parent_id: account._id,
        is_delete: { $ne: true },
      }).session(session);
      if (childCount > 0) {
        throw new BadRequest(
          "Cannot delete an account that still has child accounts.",
        );
      }

      const before = account.toObject();
      account.is_delete = true;
      await account.save({ session });

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: ChartOfAccountModel.collection.collectionName,
          },
          $push: {
            activities: {
              type: "DELETE",
              before,
              after: account.toObject(),
              created_by: req?.login?.user_id ?? null,
            },
          },
        },
        { upsert: true, session },
      );

      return account;
    });

    res.status(200).json({
      code: 200,
      success: true,
      message: "Chart of account deleted successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = controller;
