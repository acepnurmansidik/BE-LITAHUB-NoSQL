const crudServices = require("../../helper/crudService");
const { generateSequenceNo } = require("../../helper/sequence");
const AccountReceivableModel = require("../models/AccountReceivable.model");
const ChartOfAccountModel = require("../models/ChartOfAccount.model");
const BadRequest = require("../../utils/errors/bad-request");
const { getOrSetCache } = require("../../helper/redis-cache");
const { emitEvent } = require("../../../config/socket-server");
const LogActionModel = require("../models/LogAction.model");

const controller = {};

// Nama event = pattern cache. emitEvent(AR_EVENT, ...) otomatis membersihkan
// cache "update_account_receivable:*" lalu broadcast ke semua client, jadi
// client cukup listen event ini lalu refetch (lihat contoh useEffect di FE).
const AR_EVENT = "update_account_receivable";
const MODULE_NAME = AccountReceivableModel.collection.collectionName;

const { runWithOptionalTransaction } = crudServices;

const STATUSES = ["DRAFT", "OPEN", "PARTIAL", "PAID", "WRITE_OFF"];
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Validasi & normalisasi baris. Tiap baris wajib menunjuk akun COA POSTABLE
// (bukan header) yang ada, dengan amount > 0. Kode/nama akun di-snapshot.
const buildLines = async (rawLines, session) => {
  if (!Array.isArray(rawLines) || rawLines.length < 1) {
    throw new BadRequest("At least 1 line is required.");
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

  let total = 0;
  const lines = rawLines.map((raw, index) => {
    const acc = raw.account_id ? byId.get(String(raw.account_id)) : null;
    if (!acc) throw new BadRequest(`Line ${index + 1}: account not found.`);
    if (acc.is_header) {
      throw new BadRequest(
        `Line ${index + 1}: cannot use a header account (${acc.code}).`,
      );
    }
    const amount = round2(raw.amount);
    if (amount <= 0) {
      throw new BadRequest(`Line ${index + 1}: amount must be greater than 0.`);
    }
    total += amount;
    return {
      account_id: acc._id,
      account_code: acc.code,
      account_name: acc.name,
      description: String(raw.description ?? "").trim(),
      amount,
    };
  });

  total = round2(total);
  if (total <= 0) throw new BadRequest("Total amount cannot be zero.");
  return { lines, total };
};

// Selaraskan status dengan paid_amount (clamp paid ke [0, total]).
const normalizeStatus = (rawStatus, total, rawPaid) => {
  const paid = Math.min(Math.max(round2(rawPaid), 0), round2(total));
  let status = STATUSES.includes(String(rawStatus).toUpperCase())
    ? String(rawStatus).toUpperCase()
    : "DRAFT";

  // WRITE_OFF ditetapkan lewat proses write-off — jangan ditimpa oleh paid.
  if (status === "WRITE_OFF") return { status, paid };

  if (total > 0 && paid >= total) status = "PAID";
  else if (paid > 0) status = "PARTIAL";
  else if (status !== "DRAFT") status = "OPEN";
  return { status, paid };
};

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['Account Receivable']
    #swagger.summary = 'List Account Receivables'
    #swagger.description = 'Returns a paginated list of accounts receivable (customer invoices).'
    #swagger.parameters['page'] = { default: 1 }
    #swagger.parameters['limit'] = { default: 10 }
    #swagger.parameters['search'] = { default: '', description: 'entry_no / party_name / description / reference' }
    #swagger.parameters['status'] = { default: '', description: 'DRAFT | OPEN | PARTIAL | PAID' }
  */
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { search, status } = req.query;

    const baseQuery = { is_delete: { $ne: true } };
    if (search) {
      baseQuery["$or"] = [
        { entry_no: { $regex: search, $options: "i" } },
        { party_name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { reference: { $regex: search, $options: "i" } },
      ];
    }
    const query = { ...baseQuery };
    if (status && STATUSES.includes(String(status).toUpperCase())) {
      query.status = String(status).toUpperCase();
    }

    const [data, total, counts] = await Promise.all([
      AccountReceivableModel.find(query)
        .sort({ date: -1, entry_no: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("-is_delete"),
      AccountReceivableModel.countDocuments(query),
      AccountReceivableModel.aggregate([
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
    #swagger.tags = ['Account Receivable']
    #swagger.summary = 'Get Account Receivable detail'
    #swagger.description = 'Returns the detail of a single account receivable by id.'
    #swagger.parameters['id'] = { description: 'id account receivable' }
  */
  try {
    const { id } = req.params;
    const data = await AccountReceivableModel.findOne({
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
    #swagger.tags = ['Account Receivable']
    #swagger.summary = 'Create Account Receivable'
    #swagger.description = 'Creates a new account receivable (customer invoice).'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create Account Receivable',
      schema: { $ref: '#/definitions/BodyAccountReceivableSchema' }
    }
  */
  try {
    const payload = req.body;
    const date = payload.date ? new Date(payload.date) : new Date();
    if (Number.isNaN(date.getTime())) throw new BadRequest("Invalid date.");
    let dueDate;
    if (payload.due_date) {
      dueDate = new Date(payload.due_date);
      if (Number.isNaN(dueDate.getTime())) {
        throw new BadRequest("Invalid due date.");
      }
    }

    const result = await runWithOptionalTransaction(async (session) => {
      const { lines, total } = await buildLines(payload.lines, session);
      const { status, paid } = normalizeStatus(
        payload.status,
        total,
        payload.paid_amount,
      );
      // Nomor urut dari koleksi `sequence` (modul AR, per bulan/tahun).
      const entry_no = await generateSequenceNo({
        module: MODULE_NAME,
        prefix: "AR",
        date,
        session,
      });

      const [doc] = await AccountReceivableModel.create(
        [
          {
            entry_no,
            date,
            due_date: dueDate,
            party_name: String(payload.party_name ?? "").trim(),
            reference: String(payload.reference ?? "").trim(),
            description: String(payload.description ?? "").trim(),
            status,
            lines,
            total_amount: total,
            paid_amount: paid,
            total_remaining: total - paid,
          },
        ],
        { session },
      );

      await LogActionModel.create(
        [
          {
            target_id: doc._id,
            source: AccountReceivableModel.collection.collectionName,
            activities: [{ type: "CREATE", after: doc.toObject() }],
          },
        ],
        { session },
      );

      return doc;
    });

    await emitEvent(AR_EVENT);

    res.status(201).json({
      code: 201,
      success: true,
      message: "Account receivable created successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.update = async (req, res, next) => {
  /*
    #swagger.tags = ['Account Receivable']
    #swagger.summary = 'Update Account Receivable'
    #swagger.description = 'Updates an account receivable and recomputes its payment status.'
    #swagger.parameters['id'] = { description: 'id account receivable' }
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Update Account Receivable',
      schema: { $ref: '#/definitions/BodyAccountReceivableSchema' }
    }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await AccountReceivableModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new BadRequest("Data not found!");

      const before = doc.toObject();

      if (payload.date !== undefined) {
        const date = new Date(payload.date);
        if (Number.isNaN(date.getTime())) throw new BadRequest("Invalid date.");
        doc.date = date;
      }
      if (payload.due_date !== undefined) {
        if (payload.due_date) {
          const dueDate = new Date(payload.due_date);
          if (Number.isNaN(dueDate.getTime())) {
            throw new BadRequest("Invalid due date.");
          }
          doc.due_date = dueDate;
        } else {
          doc.due_date = undefined;
        }
      }
      if (payload.party_name !== undefined) {
        doc.party_name = String(payload.party_name).trim();
      }
      if (payload.reference !== undefined) {
        doc.reference = String(payload.reference).trim();
      }
      if (payload.description !== undefined) {
        doc.description = String(payload.description).trim();
      }
      if (payload.lines !== undefined) {
        const { lines, total } = await buildLines(payload.lines, session);
        doc.lines = lines;
        doc.total_amount = total;
      }

      const { status, paid } = normalizeStatus(
        payload.status !== undefined ? payload.status : doc.status,
        doc.total_amount,
        payload.paid_amount !== undefined
          ? payload.paid_amount
          : doc.paid_amount,
      );
      doc.status = status;
      doc.paid_amount = paid;
      doc.total_remaining = doc.total_amount - paid;

      await doc.save({ session });

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: AccountReceivableModel.collection.collectionName,
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
      code: 200,
      success: true,
      message: "Account receivable updated successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.delete = async (req, res, next) => {
  /*
    #swagger.tags = ['Account Receivable']
    #swagger.summary = 'Delete Account Receivable (soft delete)'
    #swagger.description = 'Soft-deletes an account receivable; rejected when a payment has already been recorded.'
    #swagger.parameters['id'] = { description: 'id account receivable' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const doc = await AccountReceivableModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!doc) throw new BadRequest("Data not found!");
      if (round2(doc.paid_amount) > 0) {
        throw new BadRequest(
          "Cannot delete: this document already has a payment recorded.",
        );
      }

      const before = doc.toObject();
      doc.is_delete = true;
      await doc.save({ session });

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: AccountReceivableModel.collection.collectionName,
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
      code: 200,
      success: true,
      message: "Account receivable deleted successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = controller;
