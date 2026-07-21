const crudServices = require("../../helper/crudService");
const JournalEntryModel = require("../models/JournalEntry.model");
const ChartOfAccountModel = require("../models/ChartOfAccount.model");
const logActionModel = require("../models/LogAction.model");
const BadRequest = require("../../utils/errors/bad-request");

const controller = {};

const { runWithOptionalTransaction } = crudServices;

const STATUSES = ["DRAFT", "POSTED"];

// Bulatkan ke 2 desimal untuk menghindari galat floating-point saat cek balance.
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Buat nomor jurnal unik berformat JE-YYYYMM-#### (sekuensial per bulan).
const generateEntryNo = async (date, session) => {
  const d = date instanceof Date ? date : new Date(date);
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `JE-${ym}-`;

  // Ambil nomor terakhir bulan ini untuk menentukan urutan berikutnya.
  const last = await JournalEntryModel.findOne({
    entry_no: { $regex: `^${prefix}` },
  })
    .sort({ entry_no: -1 })
    .session(session ?? null);

  let seq = 1;
  if (last) {
    const n = parseInt(last.entry_no.slice(prefix.length), 10);
    if (Number.isFinite(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
};

// Validasi & normalisasi baris jurnal. Memastikan tiap baris menunjuk akun
// POSTABLE (bukan header) yang ada, hanya salah satu debit/credit terisi, lalu
// mengembalikan { lines, total_debit, total_credit } dengan snapshot kode/nama.
const buildLines = async (rawLines, session) => {
  if (!Array.isArray(rawLines) || rawLines.length < 2) {
    throw new BadRequest("Journal must have at least 2 lines.");
  }

  // Ambil semua akun yang direferensikan sekaligus.
  const ids = [
    ...new Set(
      rawLines
        .map((l) => l && l.account_id)
        .filter(Boolean)
        .map(String),
    ),
  ];
  const accounts = await ChartOfAccountModel.find({
    _id: { $in: ids },
    is_delete: { $ne: true },
  }).session(session ?? null);
  const byId = new Map(accounts.map((a) => [String(a._id), a]));

  let totalDebit = 0;
  let totalCredit = 0;

  const lines = rawLines.map((raw, index) => {
    const acc = raw.account_id ? byId.get(String(raw.account_id)) : null;
    if (!acc) {
      throw new BadRequest(`Line ${index + 1}: account not found.`);
    }
    if (acc.is_header) {
      throw new BadRequest(
        `Line ${index + 1}: cannot post to a header account (${acc.code}).`,
      );
    }

    const debit = round2(raw.debit);
    const credit = round2(raw.credit);
    if (debit < 0 || credit < 0) {
      throw new BadRequest(`Line ${index + 1}: amount cannot be negative.`);
    }
    if (debit > 0 && credit > 0) {
      throw new BadRequest(
        `Line ${index + 1}: fill either debit OR credit, not both.`,
      );
    }
    if (debit === 0 && credit === 0) {
      throw new BadRequest(`Line ${index + 1}: debit or credit is required.`);
    }

    totalDebit += debit;
    totalCredit += credit;

    return {
      account_id: acc._id,
      account_code: acc.code,
      account_name: acc.name,
      description: String(raw.description ?? "").trim(),
      debit,
      credit,
    };
  });

  totalDebit = round2(totalDebit);
  totalCredit = round2(totalCredit);
  if (totalDebit !== totalCredit) {
    throw new BadRequest(
      `Journal is not balanced: total debit (${totalDebit}) must equal total credit (${totalCredit}).`,
    );
  }
  if (totalDebit === 0) {
    throw new BadRequest("Journal total cannot be zero.");
  }

  return { lines, total_debit: totalDebit, total_credit: totalCredit };
};

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['JOURNAL ENTRY']
    #swagger.summary = 'Journal Entry'
    #swagger.description = 'Master jurnal umum (double-entry)'
    #swagger.parameters['page'] = { default: 1 }
    #swagger.parameters['limit'] = { default: 10 }
    #swagger.parameters['search'] = { default: '', description: 'search by entry_no / description / reference' }
    #swagger.parameters['status'] = { default: '', description: 'DRAFT | POSTED' }
  */
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { search, status } = req.query;

    const query = { is_delete: { $ne: true } };
    if (search) {
      query["$or"] = [
        { entry_no: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { reference: { $regex: search, $options: "i" } },
      ];
    }
    if (status && STATUSES.includes(String(status).toUpperCase())) {
      query.status = String(status).toUpperCase();
    }

    const [data, total] = await Promise.all([
      JournalEntryModel.find(query)
        .sort({ date: -1, entry_no: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("-is_delete"),
      JournalEntryModel.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: total,
      current_page: page,
    });
  } catch (err) {
    next(err);
  }
};

controller.show = async (req, res, next) => {
  /*
    #swagger.tags = ['JOURNAL ENTRY']
    #swagger.summary = 'Journal Entry'
    #swagger.description = 'Detail satu entri jurnal'
    #swagger.parameters['id'] = { description: 'id journal entry' }
  */
  try {
    const { id } = req.params;
    const data = await JournalEntryModel.findOne({
      _id: id,
      is_delete: { $ne: true },
    }).select("-is_delete");
    if (!data) throw new BadRequest("Data not found!");

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
    });
  } catch (err) {
    next(err);
  }
};

controller.create = async (req, res, next) => {
  /*
    #swagger.tags = ['JOURNAL ENTRY']
    #swagger.summary = 'Journal Entry'
    #swagger.description = 'Buat entri jurnal baru (harus balance)'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create journal entry',
      schema: { $ref: '#/definitions/BodyJournalEntrySchema' }
    }
  */
  try {
    const payload = req.body;

    const date = payload.date ? new Date(payload.date) : new Date();
    if (Number.isNaN(date.getTime())) throw new BadRequest("Invalid date.");

    const status = STATUSES.includes(String(payload.status).toUpperCase())
      ? String(payload.status).toUpperCase()
      : "DRAFT";

    const result = await runWithOptionalTransaction(async (session) => {
      const { lines, total_debit, total_credit } = await buildLines(
        payload.lines,
        session,
      );

      const entry_no = await generateEntryNo(date, session);

      const [entry] = await JournalEntryModel.create(
        [
          {
            entry_no,
            date,
            description: String(payload.description ?? "").trim(),
            reference: String(payload.reference ?? "").trim(),
            status,
            lines,
            total_debit,
            total_credit,
          },
        ],
        { session },
      );

      await logActionModel.create(
        [
          {
            target_id: entry._id,
            source: JournalEntryModel.collection.collectionName,
            activities: [{ type: "CREATE", after: entry.toObject() }],
          },
        ],
        { session },
      );

      return entry;
    });

    res.status(201).json({
      code: 201,
      success: true,
      message: "Journal entry created successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.update = async (req, res, next) => {
  /*
    #swagger.tags = ['JOURNAL ENTRY']
    #swagger.summary = 'Journal Entry'
    #swagger.description = 'Perbarui entri jurnal (entri POSTED tak bisa diubah)'
    #swagger.parameters['id'] = { description: 'id journal entry' }
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Update journal entry',
      schema: { $ref: '#/definitions/BodyJournalEntrySchema' }
    }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const entry = await JournalEntryModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!entry) throw new BadRequest("Data not found!");

      // Entri yang sudah POSTED terkunci — hanya boleh diubah statusnya (mis.
      // dibatalkan kembali ke DRAFT bila diizinkan bisnis; di sini kita larang
      // edit isi agar integritas buku besar terjaga).
      if (entry.status === "POSTED" && payload.status !== "DRAFT") {
        throw new BadRequest("Posted journal entries cannot be edited.");
      }

      const before = entry.toObject();

      if (payload.date !== undefined) {
        const date = new Date(payload.date);
        if (Number.isNaN(date.getTime())) throw new BadRequest("Invalid date.");
        entry.date = date;
      }
      if (payload.description !== undefined) {
        entry.description = String(payload.description).trim();
      }
      if (payload.reference !== undefined) {
        entry.reference = String(payload.reference).trim();
      }
      if (payload.status !== undefined) {
        const nextStatus = String(payload.status).toUpperCase();
        if (!STATUSES.includes(nextStatus)) {
          throw new BadRequest(
            `Status must be one of: ${STATUSES.join(", ")}.`,
          );
        }
        entry.status = nextStatus;
      }

      // Baris hanya boleh diubah saat entri masih DRAFT.
      if (payload.lines !== undefined) {
        if (entry.status === "POSTED") {
          throw new BadRequest("Posted journal entries cannot be edited.");
        }
        const { lines, total_debit, total_credit } = await buildLines(
          payload.lines,
          session,
        );
        entry.lines = lines;
        entry.total_debit = total_debit;
        entry.total_credit = total_credit;
      }

      await entry.save({ session });

      await logActionModel.create(
        [
          {
            target_id: entry._id,
            source: JournalEntryModel.collection.collectionName,
            activities: [{ type: "UPDATE", before, after: entry.toObject() }],
          },
        ],
        { session },
      );

      return entry;
    });

    res.status(200).json({
      code: 200,
      success: true,
      message: "Journal entry updated successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.delete = async (req, res, next) => {
  /*
    #swagger.tags = ['JOURNAL ENTRY']
    #swagger.summary = 'Journal Entry'
    #swagger.description = 'Hapus entri jurnal (soft delete). Entri POSTED ditolak.'
    #swagger.parameters['id'] = { description: 'id journal entry' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const entry = await JournalEntryModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!entry) throw new BadRequest("Data not found!");
      if (entry.status === "POSTED") {
        throw new BadRequest("Posted journal entries cannot be deleted.");
      }

      const before = entry.toObject();
      entry.is_delete = true;
      await entry.save({ session });

      await logActionModel.create(
        [
          {
            target_id: entry._id,
            source: JournalEntryModel.collection.collectionName,
            activities: [{ type: "DELETE", before, after: entry.toObject() }],
          },
        ],
        { session },
      );

      return entry;
    });

    res.status(200).json({
      code: 200,
      success: true,
      message: "Journal entry deleted successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = controller;
