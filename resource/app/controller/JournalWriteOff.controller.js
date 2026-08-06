const crudServices = require("../../helper/crudService");
const { generateSequenceNo } = require("../../helper/sequence");
const JournalWriteOffModel = require("../models/JournalWriteOff.model");
const JournalEntryModel = require("../models/JournalEntry.model");
const AccountReceivableModel = require("../models/AccountReceivable.model");
const AccountPayableModel = require("../models/AccountPayable.model");
const ChartOfAccountModel = require("../models/ChartOfAccount.model");
const BadRequest = require("../../utils/errors/bad-request");
const LogActionModel = require("../models/LogAction.model");

const controller = {};

const { runWithOptionalTransaction } = crudServices;
const MODULE_NAME = JournalWriteOffModel.collection.collectionName;

const STATUSES = ["DRAFT", "POSTED"];
const WRITE_OFF_TYPES = ["RECEIVABLE", "PAYABLE", "INVENTORY", "OTHER"];
const SOURCE_TYPES = [
  "NONE",
  "JOURNAL_ENTRY",
  "ACCOUNT_RECEIVABLE",
  "ACCOUNT_PAYABLE",
];
// Peta source_type → Model dokumen sumber (yang ditautkan write-off).
const SOURCE_MODELS = {
  JOURNAL_ENTRY: JournalEntryModel,
  ACCOUNT_RECEIVABLE: AccountReceivableModel,
  ACCOUNT_PAYABLE: AccountPayableModel,
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const normalizeType = (v) => {
  const t = String(v ?? "").toUpperCase();
  return WRITE_OFF_TYPES.includes(t) ? t : "OTHER";
};

// Validasi & snapshot dokumen sumber yang dihapus (Journal Entry / AR / AP).
// Mengembalikan { source_type, source_id, source_no }.
const resolveSource = async (rawType, rawId, session) => {
  const type = SOURCE_TYPES.includes(String(rawType).toUpperCase())
    ? String(rawType).toUpperCase()
    : "NONE";
  if (type === "NONE" || !rawId) {
    return { source_type: "NONE", source_id: undefined, source_no: "" };
  }
  const Model = SOURCE_MODELS[type];
  const src = await Model.findOne({
    _id: rawId,
    is_delete: { $ne: true },
  }).session(session ?? null);
  if (!src) {
    throw new BadRequest("Source document (link) not found.");
  }
  return { source_type: type, source_id: src._id, source_no: src.entry_no };
};

// Efek write-off ke dokumen sumber (sesuai modelnya):
//  - JOURNAL_ENTRY     → status jurnal jadi POSTED,
//  - ACCOUNT_RECEIVABLE
//    / ACCOUNT_PAYABLE  → status jadi WRITE_OFF & sisa (remaining) dinolkan
//                         (paid_amount = total_amount).
const applyWriteOffToSource = async (sourceType, sourceId, session) => {
  if (!sourceId || sourceType === "NONE") return;

  if (sourceType === "JOURNAL_ENTRY") {
    await JournalEntryModel.updateOne(
      { _id: sourceId, is_delete: { $ne: true } },
      { $set: { status: "POSTED" } },
      { session },
    );
    return;
  }

  const Model = SOURCE_MODELS[sourceType];
  if (!Model) return;
  const doc = await Model.findOne({
    _id: sourceId,
    is_delete: { $ne: true },
  }).session(session ?? null);
  if (!doc) return;
  doc.status = "WRITE_OFF";
  doc.total_remaining = 0; // remaining = 0
  await doc.save({ session });
};

// Validasi & normalisasi baris. Minimal 2 baris, tiap baris menunjuk akun COA
// POSTABLE (bukan header), hanya salah satu debit/credit terisi, dan total
// debit HARUS sama dengan total credit (seimbang). Kode/nama akun di-snapshot.
const buildLines = async (rawLines, session) => {
  if (!Array.isArray(rawLines) || rawLines.length < 2) {
    throw new BadRequest("Write off must have at least 2 lines.");
  }

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
    if (!acc) throw new BadRequest(`Line ${index + 1}: account not found.`);
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
      `Write off is not balanced: total debit (${totalDebit}) must equal total credit (${totalCredit}).`,
    );
  }
  if (totalDebit === 0) {
    throw new BadRequest("Write off total cannot be zero.");
  }

  return { lines, total_debit: totalDebit, total_credit: totalCredit };
};

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['Journal Write Off']
    #swagger.summary = 'List Journal Write-Offs'
    #swagger.description = 'Returns a paginated register of write-off journal entries.'
    #swagger.parameters['page'] = { default: 1 }
    #swagger.parameters['limit'] = { default: 10 }
    #swagger.parameters['search'] = { default: '', description: 'entry_no / description / reference' }
    #swagger.parameters['status'] = { default: '', description: 'DRAFT | POSTED' }
    #swagger.parameters['write_off_type'] = { default: '', description: 'RECEIVABLE | PAYABLE | INVENTORY | OTHER' }
  */
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { search, status, write_off_type } = req.query;

    const baseQuery = { is_delete: { $ne: true } };
    if (search) {
      baseQuery["$or"] = [
        { entry_no: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { reference: { $regex: search, $options: "i" } },
      ];
    }

    const query = { ...baseQuery };
    if (status && STATUSES.includes(String(status).toUpperCase())) {
      query.status = String(status).toUpperCase();
    }

    if (
      write_off_type &&
      WRITE_OFF_TYPES.includes(String(write_off_type).toUpperCase())
    ) {
      query.write_off_type = String(write_off_type).toUpperCase();
    }

    const [data, total, counts] = await Promise.all([
      JournalWriteOffModel.find(query)
        .sort({ date: -1, entry_no: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("-is_delete"),
      JournalWriteOffModel.countDocuments(query),
      JournalWriteOffModel.aggregate([
        { $match: baseQuery },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    // { STATUS: jumlah, ... } + total keseluruhan (mengikuti filter search).
    const status_counts = counts.reduce(
      (acc, c) => {
        if (c._id) acc[c._id] = c.count;
        acc.ALL += c.count;
        return acc;
      },
      { ALL: 0 },
    );

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: total,
      current_page: page,
      status_counts,
    });
  } catch (err) {
    next(err);
  }
};

controller.show = async (req, res, next) => {
  /*
    #swagger.tags = ['Journal Write Off']
    #swagger.summary = 'Get Journal Write-Off detail'
    #swagger.description = 'Returns the detail of a single write-off journal entry by id.'
    #swagger.parameters['id'] = { description: 'id journal write off' }
  */
  try {
    const { id } = req.params;
    const data = await JournalWriteOffModel.findOne({
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
    #swagger.tags = ['Journal Write Off']
    #swagger.summary = 'Create Journal Write-Off'
    #swagger.description = 'Creates a new write-off journal entry; total debit must equal total credit.'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create Journal Write-Off',
      schema: { $ref: '#/definitions/BodyJournalWriteOffSchema' }
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
      // Nomor urut dari koleksi `sequence` (modul WO, per bulan/tahun).
      const entry_no = await generateSequenceNo({
        module: MODULE_NAME,
        prefix: "WO",
        date,
        session,
      });
      const source = await resolveSource(
        payload.source_type,
        payload.source_id,
        session,
      );

      const [entry] = await JournalWriteOffModel.create(
        [
          {
            entry_no,
            date,
            write_off_type: normalizeType(payload.write_off_type),
            reference: String(payload.reference ?? "").trim(),
            description: String(payload.description ?? "").trim(),
            status,
            lines,
            total_debit,
            total_credit,
            ...source,
          },
        ],
        { session },
      );

      // Terapkan efek write-off ke dokumen sumber (JE→POSTED, AR/AP→WRITE_OFF).
      await applyWriteOffToSource(
        source.source_type,
        source.source_id,
        session,
      );

      await LogActionModel.create(
        [
          {
            target_id: entry._id,
            source: JournalWriteOffModel.collection.collectionName,
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
      message: "Journal write off created successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.update = async (req, res, next) => {
  /*
    #swagger.tags = ['Journal Write Off']
    #swagger.summary = 'Update Journal Write-Off'
    #swagger.description = 'Updates a write-off journal entry; posted entries can no longer be edited.'
    #swagger.parameters['id'] = { description: 'id journal write off' }
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Update Journal Write-Off',
      schema: { $ref: '#/definitions/BodyJournalWriteOffSchema' }
    }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const entry = await JournalWriteOffModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!entry) throw new BadRequest("Data not found!");

      // Entri POSTED terkunci (hanya boleh dikembalikan ke DRAFT).
      if (entry.status === "POSTED" && payload.status !== "DRAFT") {
        throw new BadRequest("Posted write off entries cannot be edited.");
      }

      const before = entry.toObject();

      if (payload.date !== undefined) {
        const date = new Date(payload.date);
        if (Number.isNaN(date.getTime())) throw new BadRequest("Invalid date.");
        entry.date = date;
      }
      if (payload.write_off_type !== undefined) {
        entry.write_off_type = normalizeType(payload.write_off_type);
      }
      if (payload.reference !== undefined) {
        entry.reference = String(payload.reference).trim();
      }
      if (payload.description !== undefined) {
        entry.description = String(payload.description).trim();
      }
      if (payload.status !== undefined) {
        const nextStatus = String(payload.status).toUpperCase();
        if (!STATUSES.includes(nextStatus)) {
          throw new BadRequest(
            `Status must be one of: ${STATUSES.join(", ")}.`,
          );
        }
        entry.status = nextStatus;
        console.log("entry.status = nextStatus", nextStatus);
      }

      if (payload.lines !== undefined) {
        const { lines, total_debit, total_credit } = await buildLines(
          payload.lines,
          session,
        );
        entry.lines = lines;
        entry.total_debit = total_debit;
        entry.total_credit = total_credit;
      }

      // Tautan sumber (JE/AR/AP) bila dikirim.
      if (
        payload.source_type !== undefined ||
        payload.source_id !== undefined
      ) {
        const source = await resolveSource(
          payload.source_type ?? entry.source_type,
          payload.source_id ?? entry.source_id,
          session,
        );
        entry.source_type = source.source_type;
        entry.source_id = source.source_id;
        entry.source_no = source.source_no;
        // Terapkan efek write-off ke dokumen sumber yang (baru) ditautkan.
        await applyWriteOffToSource(
          source.source_type,
          source.source_id,
          session,
        );
      }

      await entry.save({ session });

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: JournalWriteOffModel.collection.collectionName,
          },
          $push: {
            activities: {
              type: "UPDATE",
              before,
              after: entry.toObject(),
              created_by: req?.login?.user_id ?? null,
            },
          },
        },
        { upsert: true, session },
      );

      return entry;
    });

    res.status(200).json({
      code: 200,
      success: true,
      message: "Journal write off updated successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.delete = async (req, res, next) => {
  /*
    #swagger.tags = ['Journal Write Off']
    #swagger.summary = 'Delete Journal Write-Off (soft delete)'
    #swagger.description = 'Soft-deletes a write-off journal entry; posted entries cannot be deleted.'
    #swagger.parameters['id'] = { description: 'id journal write off' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const entry = await JournalWriteOffModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!entry) throw new BadRequest("Data not found!");
      if (entry.status === "POSTED") {
        throw new BadRequest("Posted write off entries cannot be deleted.");
      }

      const before = entry.toObject();
      entry.is_delete = true;
      await entry.save({ session });

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: JournalWriteOffModel.collection.collectionName,
          },
          $push: {
            activities: {
              type: "DELETE",
              before,
              after: entry.toObject(),
              created_by: req?.login?.user_id ?? null,
            },
          },
        },
        { upsert: true, session },
      );

      return entry;
    });

    res.status(200).json({
      code: 200,
      success: true,
      message: "Journal write off deleted successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = controller;
