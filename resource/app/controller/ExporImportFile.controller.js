// ============================================================
// EXPORT / IMPORT FILE controller (Inventory & Procurement).
// Every module has its own explicit endpoint and its own handler function
// (no dynamic ":module" dispatch). Each handler keeps its module-specific
// logic inline; only the truly generic helpers below are shared.
//
//  - IMPORT (POST /import-export/<module>/import, multipart field "file"):
//      read the Excel (.xlsx) on the server -> validate + de-duplicate ->
//      UPSERT (bulkWrite) by each module's natural key so rows are never
//      duplicated. For product / stock-position / stock-movement, when a row
//      already exists only quantity / selling_price / purchase_price change.
//  - EXPORT (GET /import-export/<module>/export?range=7d|1m|1y):
//      the server only RETURNS the data (flat JSON rows) filtered by
//      created_at; the Excel file itself is built on the frontend.
// ============================================================

const xlsx = require("xlsx");
const BadRequest = require("../../utils/errors/bad-request");
const globalService = require("../../helper/global-func");

const ProductModel = require("../models/Product.model");
const ProductCategoryModel = require("../models/ProductCategory.model");
const UomModel = require("../models/Uom.model");
const WarehouseModel = require("../models/Warehouse.model");
const SupplierModel = require("../models/Supplier.model");
const StockPositionModel = require("../models/StockPosition.model");
const StockMovementModel = require("../models/StockMovement.model");
const PurchaseRequestModel = require("../models/PurchaseRequest.model");
const PurchaseOrderModel = require("../models/PurchaseOrder.model");
const GoodReceiptModel = require("../models/GoodReceipt.model");
const DeliveryOrderModel = require("../models/DeliveryOrder.model");
const JournalEntryModel = require("../models/JournalEntry.model");
const JournalWriteOffModel = require("../models/JournalWriteOff.model");
const AccountReceivableModel = require("../models/AccountReceivable.model");
const AccountPayableModel = require("../models/AccountPayable.model");
const ChartOfAccountModel = require("../models/ChartOfAccount.model");
const DetailProductItemModel = require("../models/DetailProductItem.model");
const SupplierPricingModel = require("../models/SupplierPricing.model");

const controller = {};

// ============================================================
// Shared helpers — small, generic, and module-agnostic. These are the only
// things reused across handlers ("kecuali yang berulang"); anything module
// specific stays inline in its own handler.
// ============================================================

const norm = (v) => String(v ?? "").trim();
const upper = (v) => norm(v).toUpperCase();
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const bool = (v, def = true) => {
  const s = norm(v).toLowerCase();
  if (s === "") return def;
  return ["1", "true", "yes", "ya", "aktif", "active"].includes(s);
};
const pad2 = (n) => String(n).padStart(2, "0");

// Format a Date -> "DD/MM/YYYY HH:mm" (used on export). Returns "" when empty.
const fmtDateTime = (val) => {
  if (!val) return "";
  const d = val instanceof Date ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

// Format a Date -> "DD/MM/YYYY" (date only). Returns "" when empty.
const fmtDate = (val) => {
  if (!val) return "";
  const d = val instanceof Date ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};

// Parse a date on import: accepts "DD/MM/YYYY HH:mm", "DD/MM/YYYY", ISO, or a
// Date / Excel serial number. Returns null when empty or invalid.
const parseDateTime = (val) => {
  if (val === "" || val === null || val === undefined) return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val;
  // Excel serial number (days since 1899-12-30).
  if (typeof val === "number") {
    const ms = Math.round((val - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(val).trim();
  // DD/MM/YYYY [HH:mm[:ss]]
  const m = s.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (m) {
    const [, dd, mm, yyyy, hh = "0", mi = "0", ss = "0"] = m;
    const d = new Date(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(mi),
      Number(ss),
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Format Date values in an export row: `created_at` keeps date + time
// (DD/MM/YYYY HH:mm); every other date field is date only (DD/MM/YYYY).
const formatRowDates = (row) => {
  const out = {};
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (v instanceof Date) {
      out[k] = k === "created_at" ? fmtDateTime(v) : fmtDate(v);
    } else {
      out[k] = v;
    }
  }
  return out;
};

// Turn a created_at range preset into a threshold date. Null = no filter (all).
const rangeToDate = (range) => {
  const now = new Date();
  switch (norm(range)) {
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "1m": {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      return d;
    }
    case "1y": {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() - 1);
      return d;
    }
    default:
      return null;
  }
};

// Read the Excel buffer -> array of row objects (keys = column headers).
const parseRows = (file) => {
  if (!file || !file.buffer) {
    throw new BadRequest("File is required (field 'file').");
  }
  let wb;
  try {
    wb = xlsx.read(file.buffer, { type: "buffer" });
  } catch {
    throw new BadRequest("Unable to read the uploaded file. Use .xlsx format.");
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new BadRequest("The uploaded file has no sheet.");
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "", raw: true });
  if (rows.length < 1) throw new BadRequest("The file has no data rows.");
  return rows;
};

// Normalize a column name: lowercase and drop spaces/underscores, so that the
// headers "Purchase Price", "purchase_price" and "purchaseprice" all match.
const normKey = (s) => String(s).toLowerCase().replace(/[\s_]+/g, "");

// Read a column from a row, tolerant of case and space/underscore differences.
const pick = (row, ...keys) => {
  const map = {};
  for (const k of Object.keys(row)) map[normKey(k)] = row[k];
  for (const k of keys) {
    const v = map[normKey(k)];
    if (v !== undefined && v !== "") return v;
  }
  return "";
};

// Build a Map of code(uppercase) -> _id for a collection (for FK lookups).
const codeIndex = async (Model, field = "code") => {
  const docs = await Model.find({ is_delete: { $ne: true } })
    .select(`_id ${field}`)
    .lean();
  const m = new Map();
  for (const d of docs) m.set(upper(d[field]), d._id);
  return m;
};

// Read a populated ref field safely (returns "" when the ref is missing).
const refField = (ref, field) =>
  ref && typeof ref === "object" ? (ref[field] ?? "") : "";

// Build a Map of COA code(upper) -> { _id, code, name, is_header } used to
// resolve account lines during finance imports.
const accountByCode = async () => {
  const docs = await ChartOfAccountModel.find({ is_delete: { $ne: true } })
    .select("_id code name is_header")
    .lean();
  const m = new Map();
  for (const d of docs) m.set(upper(d.code), d);
  return m;
};

// Group merged finance rows into records. In the exported/template layout a
// document spans several rows (one per account line) with its header columns
// vertically merged — so only the FIRST row of each document carries entry_no.
// A row with a non-empty entry_no starts a new record (its header is read
// once); every row that carries an account code contributes one line. This is
// how a field shaped as an array (the account lines) is expanded back into a
// single document on import.
const groupLinedRows = (
  rows,
  readHeader,
  readLine,
  keyKeys = ["entry_no", "no", "number"],
) => {
  const records = [];
  let current = null;
  for (const row of rows) {
    const keyVal = norm(pick(row, ...keyKeys));
    if (keyVal) {
      // `entry_no` kept as an alias so finance importers keep working.
      current = { key: keyVal, entry_no: keyVal, header: readHeader(row), lines: [] };
      records.push(current);
    }
    if (!current) continue; // stray line before any header row — ignore
    const line = readLine(row);
    if (line) current.lines.push(line);
  }
  return records;
};

// Build a Map of Product code(upper) -> { _id, code, name } used to resolve &
// snapshot procurement item lines on import.
const productByCode = async () => {
  const docs = await ProductModel.find({ is_delete: { $ne: true } })
    .select("_id code name")
    .lean();
  const m = new Map();
  for (const d of docs) m.set(upper(d.code), d);
  return m;
};

// Fetch the detail items of a set of procurement documents (from the shared
// `detail_product_items` collection) and group them by their parent id, so an
// export can attach each document's item lines as an `items` array.
const itemsByParent = async (parentField, ids) => {
  const items = await DetailProductItemModel.find({
    [parentField]: { $in: ids },
    is_delete: { $ne: true },
  })
    .populate("uom_id", "code")
    .populate("supplier_id", "code name")
    .populate("warehouse_id", "code name")
    .sort({ created_at: 1 })
    .lean();
  const map = new Map();
  for (const it of items) {
    const key = String(it[parentField]);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  return map;
};

// Run the bulkWrite and summarise the result. Every import handler builds its
// own `ops`/`errors` inline and passes them here for the actual write.
const runBulk = async (Model, ops, errors) => {
  let inserted = 0;
  let updated = 0;
  if (ops.length) {
    const res = await Model.bulkWrite(ops, { ordered: false });
    inserted = (res.upsertedCount || 0) + (res.insertedCount || 0);
    updated = res.modifiedCount || 0;
  }
  return {
    total_rows: ops.length + errors.length,
    inserted,
    updated,
    skipped: errors.length,
    errors: errors.slice(0, 50),
  };
};

// Apply the created_at filter to an export query: a custom start/end date pair
// takes priority, otherwise fall back to a preset range (7d|1m|1y).
const applyDateFilter = (query, req) => {
  const start = parseDateTime(req.query.start_date);
  const end = parseDateTime(req.query.end_date);
  if (start || end) {
    const cond = {};
    if (start) cond.$gte = start;
    if (end) {
      // Inclusive up to the end of end_date.
      const e = new Date(end);
      e.setHours(23, 59, 59, 999);
      cond.$lte = e;
    }
    return query.where("created_at", cond);
  }
  const since = rangeToDate(req.query.range);
  if (since) return query.where("created_at").gte(since);
  return query;
};

// ============================================================
// IMPORT handlers — one endpoint = one self-contained function.
// ============================================================

controller.importProduct = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Import Product from Excel (.xlsx)'
    #swagger.description = 'Import & upsert Product by code. When a product already exists, only purchase_price & selling_price are updated.'
    #swagger.consumes = ['multipart/form-data']
    #swagger.parameters['file'] = { in: 'formData', type: 'file', required: true, description: 'Excel .xlsx file' }
  */
  try {
    const rows = parseRows(req.file);

    // Resolve category / uom codes to their _id up front.
    const [catByPrefix, catByName, uomByCode] = await Promise.all([
      codeIndex(ProductCategoryModel, "prefix"),
      codeIndex(ProductCategoryModel, "name"),
      codeIndex(UomModel, "code"),
    ]);

    const seen = new Set();
    const ops = [];
    const errors = [];

    rows.forEach((row, i) => {
      const line = i + 2; // +1 for the header row, +1 for the 0-based index
      const code = upper(pick(row, "code", "kode"));
      const name = norm(pick(row, "name", "nama"));
      if (!code || !name) {
        errors.push(`Row ${line}: code & name are required.`);
        return;
      }
      if (seen.has(code)) return; // skip duplicates within the same file
      seen.add(code);

      const catKey = upper(pick(row, "category", "kategori", "prefix"));
      const categoryId = catByPrefix.get(catKey) || catByName.get(catKey);
      const uomId = uomByCode.get(upper(pick(row, "uom", "unit")));
      if (!categoryId || !uomId) {
        errors.push(`Row ${line}: category/uom not found (${code}).`);
        return;
      }
      const purchase_price = num(pick(row, "purchase_price", "harga_beli"));
      const selling_price = num(pick(row, "selling_price", "harga_jual"));

      ops.push({
        updateOne: {
          filter: { code },
          update: {
            // When the product already exists, only its prices are updated.
            $set: { purchase_price, selling_price },
            $setOnInsert: {
              code,
              name: name.toUpperCase(),
              slug: globalService.createSlug(name),
              product_category_id: categoryId,
              uom_id: uomId,
              barcode: norm(pick(row, "barcode")),
              description: norm(pick(row, "description", "deskripsi")),
              is_active: bool(pick(row, "is_active", "aktif")),
            },
          },
          upsert: true,
        },
      });
    });

    const summary = await runBulk(ProductModel, ops, errors);
    res.status(200).json({
      success: true,
      message: `Import 'product' finished: ${summary.inserted} created, ${summary.updated} updated, ${summary.skipped} skipped.`,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
};

controller.importProductCategory = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Import Product Category from Excel (.xlsx)'
    #swagger.description = 'Import & upsert Product Category by prefix.'
    #swagger.consumes = ['multipart/form-data']
    #swagger.parameters['file'] = { in: 'formData', type: 'file', required: true, description: 'Excel .xlsx file' }
  */
  try {
    const rows = parseRows(req.file);

    const seen = new Set();
    const ops = [];
    const errors = [];

    rows.forEach((row, i) => {
      const line = i + 2;
      const prefix = upper(pick(row, "prefix", "code", "kode"));
      if (!prefix) {
        errors.push(`Row ${line}: prefix is required.`);
        return;
      }
      if (seen.has(prefix)) return;
      seen.add(prefix);

      const name = norm(pick(row, "name", "nama"));

      ops.push({
        updateOne: {
          filter: { prefix },
          update: {
            $set: {
              name,
              slug: globalService.createSlug(name),
              is_active: bool(pick(row, "is_active", "aktif")),
            },
            $setOnInsert: { prefix },
          },
          upsert: true,
        },
      });
    });

    const summary = await runBulk(ProductCategoryModel, ops, errors);
    res.status(200).json({
      success: true,
      message: `Import 'product-category' finished: ${summary.inserted} created, ${summary.updated} updated, ${summary.skipped} skipped.`,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
};

controller.importUom = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Import UOM from Excel (.xlsx)'
    #swagger.description = 'Import & upsert UOM by code.'
    #swagger.consumes = ['multipart/form-data']
    #swagger.parameters['file'] = { in: 'formData', type: 'file', required: true, description: 'Excel .xlsx file' }
  */
  try {
    const rows = parseRows(req.file);

    const seen = new Set();
    const ops = [];
    const errors = [];

    rows.forEach((row, i) => {
      const line = i + 2;
      const code = upper(pick(row, "code", "kode"));
      if (!code) {
        errors.push(`Row ${line}: code is required.`);
        return;
      }
      if (seen.has(code)) return;
      seen.add(code);

      ops.push({
        updateOne: {
          filter: { code },
          update: {
            $set: {
              name: norm(pick(row, "name", "nama")),
              description: norm(pick(row, "description", "deskripsi")),
              is_active: bool(pick(row, "is_active", "aktif")),
            },
            $setOnInsert: { code },
          },
          upsert: true,
        },
      });
    });

    const summary = await runBulk(UomModel, ops, errors);
    res.status(200).json({
      success: true,
      message: `Import 'uom' finished: ${summary.inserted} created, ${summary.updated} updated, ${summary.skipped} skipped.`,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
};

controller.importWarehouse = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Import Warehouse from Excel (.xlsx)'
    #swagger.description = 'Import & upsert Warehouse by code.'
    #swagger.consumes = ['multipart/form-data']
    #swagger.parameters['file'] = { in: 'formData', type: 'file', required: true, description: 'Excel .xlsx file' }
  */
  try {
    const rows = parseRows(req.file);

    const seen = new Set();
    const ops = [];
    const errors = [];

    rows.forEach((row, i) => {
      const line = i + 2;
      const code = upper(pick(row, "code", "kode"));
      if (!code) {
        errors.push(`Row ${line}: code is required.`);
        return;
      }
      if (seen.has(code)) return;
      seen.add(code);

      ops.push({
        updateOne: {
          filter: { code },
          update: {
            $set: {
              name: norm(pick(row, "name", "nama")),
              phone: norm(pick(row, "phone", "telepon")),
              address: {
                street: norm(pick(row, "street", "alamat")),
                city: norm(pick(row, "city", "kota")),
                state_province: norm(pick(row, "state_province", "provinsi")),
                postal_code: norm(pick(row, "postal_code", "kode_pos")),
                country: norm(pick(row, "country", "negara")) || "Indonesia",
              },
              is_active: bool(pick(row, "is_active", "aktif")),
            },
            $setOnInsert: { code },
          },
          upsert: true,
        },
      });
    });

    const summary = await runBulk(WarehouseModel, ops, errors);
    res.status(200).json({
      success: true,
      message: `Import 'warehouse' finished: ${summary.inserted} created, ${summary.updated} updated, ${summary.skipped} skipped.`,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
};

controller.importSupplier = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Import Supplier from Excel (.xlsx)'
    #swagger.description = 'Import & upsert Supplier by code.'
    #swagger.consumes = ['multipart/form-data']
    #swagger.parameters['file'] = { in: 'formData', type: 'file', required: true, description: 'Excel .xlsx file' }
  */
  try {
    const rows = parseRows(req.file);

    const seen = new Set();
    const ops = [];
    const errors = [];

    rows.forEach((row, i) => {
      const line = i + 2;
      const code = upper(pick(row, "code", "kode"));
      if (!code) {
        errors.push(`Row ${line}: code is required.`);
        return;
      }
      if (seen.has(code)) return;
      seen.add(code);

      const phone = norm(pick(row, "phone", "telepon"));

      ops.push({
        updateOne: {
          filter: { code },
          update: {
            $set: {
              name: norm(pick(row, "name", "nama")),
              contact_info: {
                phone: phone ? [phone] : [],
                email: norm(pick(row, "email")),
                contact_person: norm(pick(row, "contact_person", "pic")),
              },
              address: {
                street: norm(pick(row, "street", "alamat")),
                city: norm(pick(row, "city", "kota")),
                state_province: norm(pick(row, "state_province", "provinsi")),
                postal_code: norm(pick(row, "postal_code", "kode_pos")),
                country: norm(pick(row, "country", "negara")) || "Indonesia",
              },
              is_active: bool(pick(row, "is_active", "aktif")),
            },
            $setOnInsert: { code },
          },
          upsert: true,
        },
      });
    });

    const summary = await runBulk(SupplierModel, ops, errors);
    res.status(200).json({
      success: true,
      message: `Import 'supplier' finished: ${summary.inserted} created, ${summary.updated} updated, ${summary.skipped} skipped.`,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
};

controller.importStockPosition = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Import Stock Position from Excel (.xlsx)'
    #swagger.description = 'Import & upsert Stock Position by (product, warehouse). When it already exists, only quantity is updated.'
    #swagger.consumes = ['multipart/form-data']
    #swagger.parameters['file'] = { in: 'formData', type: 'file', required: true, description: 'Excel .xlsx file' }
  */
  try {
    const rows = parseRows(req.file);

    const [prodByCode, whByCode, uomByCode] = await Promise.all([
      codeIndex(ProductModel, "code"),
      codeIndex(WarehouseModel, "code"),
      codeIndex(UomModel, "code"),
    ]);

    const seen = new Set();
    const ops = [];
    const errors = [];

    rows.forEach((row, i) => {
      const line = i + 2;
      const productId = prodByCode.get(
        upper(pick(row, "product", "product_code")),
      );
      const warehouseId = whByCode.get(
        upper(pick(row, "warehouse", "warehouse_code")),
      );
      if (!productId || !warehouseId) {
        errors.push(`Row ${line}: product/warehouse not found.`);
        return;
      }
      const key = `${productId}|${warehouseId}`;
      if (seen.has(key)) return;
      seen.add(key);

      const quantity = num(pick(row, "quantity", "qty", "stock"));
      const uomId = uomByCode.get(upper(pick(row, "uom", "unit"))) || null;

      ops.push({
        updateOne: {
          filter: { product_id: productId, warehouse_id: warehouseId },
          update: {
            // When the position already exists, only quantity is updated.
            $set: { quantity },
            $setOnInsert: {
              product_id: productId,
              warehouse_id: warehouseId,
              uom_id: uomId,
              reserved_quantity: num(pick(row, "reserved_quantity")),
            },
          },
          upsert: true,
        },
      });
    });

    const summary = await runBulk(StockPositionModel, ops, errors);
    res.status(200).json({
      success: true,
      message: `Import 'stock-position' finished: ${summary.inserted} created, ${summary.updated} updated, ${summary.skipped} skipped.`,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
};

controller.importStockMovement = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Import Stock Movement from Excel (.xlsx)'
    #swagger.description = 'Import Stock Movement. Rows with a reference are upserted; rows without one are always inserted (append-only ledger).'
    #swagger.consumes = ['multipart/form-data']
    #swagger.parameters['file'] = { in: 'formData', type: 'file', required: true, description: 'Excel .xlsx file' }
  */
  try {
    const rows = parseRows(req.file);

    const [prodByCode, whByCode, uomByCode] = await Promise.all([
      codeIndex(ProductModel, "code"),
      codeIndex(WarehouseModel, "code"),
      codeIndex(UomModel, "code"),
    ]);
    const TYPES = ["IN", "OUT", "ADJUSTMENT", "TRANSFER"];

    const ops = [];
    const inserts = [];
    const errors = [];

    rows.forEach((row, i) => {
      const line = i + 2;
      const productId = prodByCode.get(
        upper(pick(row, "product", "product_code")),
      );
      const warehouseId = whByCode.get(
        upper(pick(row, "warehouse", "warehouse_code")),
      );
      if (!productId || !warehouseId) {
        errors.push(`Row ${line}: product/warehouse not found.`);
        return;
      }
      const type = upper(pick(row, "type", "tipe")) || "IN";
      if (!TYPES.includes(type)) {
        errors.push(`Row ${line}: invalid type '${type}'.`);
        return;
      }
      const quantity = num(pick(row, "quantity", "qty"));
      const reference = norm(pick(row, "reference", "ref"));
      const date = parseDateTime(pick(row, "date", "tanggal")) || new Date();
      const uomId = uomByCode.get(upper(pick(row, "uom", "unit"))) || null;
      const note = norm(pick(row, "note", "catatan"));
      const status =
        upper(pick(row, "status")) === "APPROVED" ? "APPROVED" : "DRAFT";

      // With a reference -> upsert (only quantity is updated if it exists).
      // Without a reference -> always insert (append-only ledger).
      if (reference) {
        ops.push({
          updateOne: {
            filter: { reference },
            update: {
              $set: { quantity },
              $setOnInsert: {
                product_id: productId,
                warehouse_id: warehouseId,
                uom_id: uomId,
                type,
                status,
                reference,
                date,
                note,
              },
            },
            upsert: true,
          },
        });
      } else {
        inserts.push({
          product_id: productId,
          warehouse_id: warehouseId,
          uom_id: uomId,
          type,
          status,
          quantity,
          date,
          note,
        });
      }
    });

    const allOps = [
      ...ops,
      ...inserts.map((doc) => ({ insertOne: { document: doc } })),
    ];
    const summary = await runBulk(StockMovementModel, allOps, errors);
    res.status(200).json({
      success: true,
      message: `Import 'stock-movement' finished: ${summary.inserted} created, ${summary.updated} updated, ${summary.skipped} skipped.`,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
};

controller.importJournalEntry = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Import Journal Entry from Excel (.xlsx)'
    #swagger.description = 'Import & upsert Journal Entry by entry_no. Each document spans several rows (one per account line, header columns merged). Lines resolve account_code against the Chart of Account (must be postable), totals are recomputed and the entry must be balanced (total debit == total credit).'
    #swagger.consumes = ['multipart/form-data']
    #swagger.parameters['file'] = { in: 'formData', type: 'file', required: true, description: 'Excel .xlsx file' }
  */
  try {
    const rows = parseRows(req.file);
    const coa = await accountByCode();
    const STATUSES = ["DRAFT", "POSTED"];

    const records = groupLinedRows(
      rows,
      (row) => ({
        date: parseDateTime(pick(row, "date", "tanggal")) || new Date(),
        description: norm(pick(row, "description", "keterangan")),
        reference: norm(pick(row, "reference", "ref")),
        status: STATUSES.includes(upper(pick(row, "status")))
          ? upper(pick(row, "status"))
          : "DRAFT",
      }),
      (row) => {
        const code = upper(pick(row, "account_code", "account", "kode_akun"));
        if (!code) return null;
        return {
          code,
          description: norm(
            pick(row, "account_description", "line_description", "deskripsi"),
          ),
          debit: num(pick(row, "debit")),
          credit: num(pick(row, "credit")),
        };
      },
    );

    const ops = [];
    const errors = [];
    records.forEach((rec) => {
      if (rec.lines.length < 2) {
        errors.push(`${rec.entry_no}: journal must have at least 2 lines.`);
        return;
      }
      let totalDebit = 0;
      let totalCredit = 0;
      const lines = [];
      let bad = null;
      for (const ln of rec.lines) {
        const acc = coa.get(ln.code);
        if (!acc) {
          bad = `account '${ln.code}' not found`;
          break;
        }
        if (acc.is_header) {
          bad = `account '${ln.code}' is a header (not postable)`;
          break;
        }
        const debit = round2(ln.debit);
        const credit = round2(ln.credit);
        if (debit > 0 && credit > 0) {
          bad = `line ${ln.code}: fill debit OR credit, not both`;
          break;
        }
        if (debit === 0 && credit === 0) {
          bad = `line ${ln.code}: debit or credit is required`;
          break;
        }
        totalDebit += debit;
        totalCredit += credit;
        lines.push({
          account_id: acc._id,
          account_code: acc.code,
          account_name: acc.name,
          description: ln.description,
          debit,
          credit,
        });
      }
      if (bad) {
        errors.push(`${rec.entry_no}: ${bad}.`);
        return;
      }
      totalDebit = round2(totalDebit);
      totalCredit = round2(totalCredit);
      if (totalDebit !== totalCredit) {
        errors.push(
          `${rec.entry_no}: not balanced (debit ${totalDebit} != credit ${totalCredit}).`,
        );
        return;
      }
      if (totalDebit === 0) {
        errors.push(`${rec.entry_no}: total cannot be zero.`);
        return;
      }
      ops.push({
        updateOne: {
          filter: { entry_no: rec.entry_no },
          update: {
            $set: {
              date: rec.header.date,
              description: rec.header.description,
              reference: rec.header.reference,
              status: rec.header.status,
              lines,
              total_debit: totalDebit,
              total_credit: totalCredit,
            },
            $setOnInsert: { entry_no: rec.entry_no },
          },
          upsert: true,
        },
      });
    });

    const summary = await runBulk(JournalEntryModel, ops, errors);
    res.status(200).json({
      success: true,
      message: `Import 'journal-entry' finished: ${summary.inserted} created, ${summary.updated} updated, ${summary.skipped} skipped.`,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
};

controller.importJournalWriteOff = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Import Journal Write-Off from Excel (.xlsx)'
    #swagger.description = 'Import & upsert Journal Write-Off by entry_no. Same double-entry rules as Journal Entry (balanced debit/credit, postable accounts) plus write_off_type / source_type.'
    #swagger.consumes = ['multipart/form-data']
    #swagger.parameters['file'] = { in: 'formData', type: 'file', required: true, description: 'Excel .xlsx file' }
  */
  try {
    const rows = parseRows(req.file);
    const coa = await accountByCode();
    const STATUSES = ["DRAFT", "POSTED"];
    const WRITE_OFF_TYPES = ["RECEIVABLE", "PAYABLE", "INVENTORY", "OTHER"];
    const SOURCE_TYPES = [
      "NONE",
      "JOURNAL_ENTRY",
      "ACCOUNT_RECEIVABLE",
      "ACCOUNT_PAYABLE",
    ];

    const records = groupLinedRows(
      rows,
      (row) => ({
        date: parseDateTime(pick(row, "date", "tanggal")) || new Date(),
        write_off_type: WRITE_OFF_TYPES.includes(
          upper(pick(row, "write_off_type", "type", "tipe")),
        )
          ? upper(pick(row, "write_off_type", "type", "tipe"))
          : "OTHER",
        reference: norm(pick(row, "reference", "ref")),
        description: norm(pick(row, "description", "keterangan")),
        source_type: SOURCE_TYPES.includes(upper(pick(row, "source_type")))
          ? upper(pick(row, "source_type"))
          : "NONE",
        source_no: norm(pick(row, "source_no", "source")),
        status: STATUSES.includes(upper(pick(row, "status")))
          ? upper(pick(row, "status"))
          : "DRAFT",
      }),
      (row) => {
        const code = upper(pick(row, "account_code", "account", "kode_akun"));
        if (!code) return null;
        return {
          code,
          description: norm(
            pick(row, "account_description", "line_description", "deskripsi"),
          ),
          debit: num(pick(row, "debit")),
          credit: num(pick(row, "credit")),
        };
      },
    );

    const ops = [];
    const errors = [];
    records.forEach((rec) => {
      if (rec.lines.length < 2) {
        errors.push(`${rec.entry_no}: write-off must have at least 2 lines.`);
        return;
      }
      let totalDebit = 0;
      let totalCredit = 0;
      const lines = [];
      let bad = null;
      for (const ln of rec.lines) {
        const acc = coa.get(ln.code);
        if (!acc) {
          bad = `account '${ln.code}' not found`;
          break;
        }
        if (acc.is_header) {
          bad = `account '${ln.code}' is a header (not postable)`;
          break;
        }
        const debit = round2(ln.debit);
        const credit = round2(ln.credit);
        if (debit > 0 && credit > 0) {
          bad = `line ${ln.code}: fill debit OR credit, not both`;
          break;
        }
        if (debit === 0 && credit === 0) {
          bad = `line ${ln.code}: debit or credit is required`;
          break;
        }
        totalDebit += debit;
        totalCredit += credit;
        lines.push({
          account_id: acc._id,
          account_code: acc.code,
          account_name: acc.name,
          description: ln.description,
          debit,
          credit,
        });
      }
      if (bad) {
        errors.push(`${rec.entry_no}: ${bad}.`);
        return;
      }
      totalDebit = round2(totalDebit);
      totalCredit = round2(totalCredit);
      if (totalDebit !== totalCredit) {
        errors.push(
          `${rec.entry_no}: not balanced (debit ${totalDebit} != credit ${totalCredit}).`,
        );
        return;
      }
      if (totalDebit === 0) {
        errors.push(`${rec.entry_no}: total cannot be zero.`);
        return;
      }
      ops.push({
        updateOne: {
          filter: { entry_no: rec.entry_no },
          update: {
            $set: {
              date: rec.header.date,
              write_off_type: rec.header.write_off_type,
              reference: rec.header.reference,
              description: rec.header.description,
              source_type: rec.header.source_type,
              source_no: rec.header.source_no,
              status: rec.header.status,
              lines,
              total_debit: totalDebit,
              total_credit: totalCredit,
            },
            $setOnInsert: { entry_no: rec.entry_no },
          },
          upsert: true,
        },
      });
    });

    const summary = await runBulk(JournalWriteOffModel, ops, errors);
    res.status(200).json({
      success: true,
      message: `Import 'journal-write-off' finished: ${summary.inserted} created, ${summary.updated} updated, ${summary.skipped} skipped.`,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
};

// Shared body for AR & AP import (identical shape: lines carry `amount`). The
// two endpoints below stay separate functions and only pass their own Model +
// label so each endpoint remains one self-contained function.
const importPartyLedger = async (req, res, next, Model, moduleLabel) => {
  const rows = parseRows(req.file);
  const coa = await accountByCode();
  const STATUSES = ["DRAFT", "OPEN", "PARTIAL", "PAID", "WRITE_OFF"];

  const records = groupLinedRows(
    rows,
    (row) => ({
      date: parseDateTime(pick(row, "date", "tanggal")) || new Date(),
      due_date: parseDateTime(pick(row, "due_date", "jatuh_tempo")),
      party_name: norm(
        pick(row, "party_name", "party", "customer", "vendor", "pihak"),
      ),
      reference: norm(pick(row, "reference", "ref")),
      description: norm(pick(row, "description", "keterangan")),
      status: STATUSES.includes(upper(pick(row, "status")))
        ? upper(pick(row, "status"))
        : "DRAFT",
      paid_amount: num(pick(row, "paid_amount", "dibayar")),
    }),
    (row) => {
      const code = upper(pick(row, "account_code", "account", "kode_akun"));
      if (!code) return null;
      return {
        code,
        description: norm(
          pick(row, "account_description", "line_description", "deskripsi"),
        ),
        amount: num(pick(row, "amount", "nominal")),
      };
    },
  );

  const ops = [];
  const errors = [];
  records.forEach((rec) => {
    if (rec.lines.length < 1) {
      errors.push(`${rec.entry_no}: at least 1 account line is required.`);
      return;
    }
    let totalAmount = 0;
    const lines = [];
    let bad = null;
    for (const ln of rec.lines) {
      const acc = coa.get(ln.code);
      if (!acc) {
        bad = `account '${ln.code}' not found`;
        break;
      }
      if (acc.is_header) {
        bad = `account '${ln.code}' is a header (not postable)`;
        break;
      }
      const amount = round2(ln.amount);
      if (amount < 0) {
        bad = `line ${ln.code}: amount cannot be negative`;
        break;
      }
      totalAmount += amount;
      lines.push({
        account_id: acc._id,
        account_code: acc.code,
        account_name: acc.name,
        description: ln.description,
        amount,
      });
    }
    if (bad) {
      errors.push(`${rec.entry_no}: ${bad}.`);
      return;
    }
    totalAmount = round2(totalAmount);
    if (totalAmount <= 0) {
      errors.push(`${rec.entry_no}: total amount must be greater than zero.`);
      return;
    }
    const paidAmount = round2(rec.header.paid_amount);
    const totalRemaining = round2(Math.max(totalAmount - paidAmount, 0));
    ops.push({
      updateOne: {
        filter: { entry_no: rec.entry_no },
        update: {
          $set: {
            date: rec.header.date,
            due_date: rec.header.due_date,
            party_name: rec.header.party_name,
            reference: rec.header.reference,
            description: rec.header.description,
            status: rec.header.status,
            lines,
            total_amount: totalAmount,
            paid_amount: paidAmount,
            total_remaining: totalRemaining,
          },
          $setOnInsert: { entry_no: rec.entry_no },
        },
        upsert: true,
      },
    });
  });

  const summary = await runBulk(Model, ops, errors);
  res.status(200).json({
    success: true,
    message: `Import '${moduleLabel}' finished: ${summary.inserted} created, ${summary.updated} updated, ${summary.skipped} skipped.`,
    data: summary,
  });
};

controller.importAccountReceivable = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Import Account Receivable from Excel (.xlsx)'
    #swagger.description = 'Import & upsert Account Receivable by entry_no. Lines resolve account_code (postable) + amount; total_amount / total_remaining are recomputed.'
    #swagger.consumes = ['multipart/form-data']
    #swagger.parameters['file'] = { in: 'formData', type: 'file', required: true, description: 'Excel .xlsx file' }
  */
  try {
    await importPartyLedger(
      req,
      res,
      next,
      AccountReceivableModel,
      "account-receivable",
    );
  } catch (err) {
    next(err);
  }
};

controller.importAccountPayable = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Import Account Payable from Excel (.xlsx)'
    #swagger.description = 'Import & upsert Account Payable by entry_no. Lines resolve account_code (postable) + amount; total_amount / total_remaining are recomputed.'
    #swagger.consumes = ['multipart/form-data']
    #swagger.parameters['file'] = { in: 'formData', type: 'file', required: true, description: 'Excel .xlsx file' }
  */
  try {
    await importPartyLedger(
      req,
      res,
      next,
      AccountPayableModel,
      "account-payable",
    );
  } catch (err) {
    next(err);
  }
};

controller.importChartOfAccount = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Import Chart of Account from Excel (.xlsx)'
    #swagger.description = 'Import & upsert Chart of Account by code. `code` is the materialized path (e.g. 1000.1100.1110); level, path, parent_id and normal_balance are derived from the code + type. Rows are processed parents-first.'
    #swagger.consumes = ['multipart/form-data']
    #swagger.parameters['file'] = { in: 'formData', type: 'file', required: true, description: 'Excel .xlsx file' }
  */
  try {
    const rows = parseRows(req.file);
    const ACCOUNT_TYPES = [
      "ASSET",
      "LIABILITY",
      "EQUITY",
      "REVENUE",
      "EXPENSE",
      "CAPITAL",
      "SALES",
      "COGS",
      "OTHER_INCOME_EXPENSE",
      "ADM_OPERATION_EXPENSE",
      "DEPRECIATION_AMORTIZATION",
      "OTHERS",
    ];
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

    const items = [];
    const errors = [];
    const seen = new Set();
    rows.forEach((row, i) => {
      const line = i + 2;
      const code = norm(pick(row, "code", "kode")); // full materialized path
      const name = norm(pick(row, "name", "nama"));
      if (!code || !name) {
        errors.push(`Row ${line}: code & name are required.`);
        return;
      }
      if (seen.has(upper(code))) return;
      seen.add(upper(code));
      const type = ACCOUNT_TYPES.includes(upper(pick(row, "type", "tipe")))
        ? upper(pick(row, "type", "tipe"))
        : "OTHERS";
      items.push({
        code,
        name,
        type,
        is_header: bool(pick(row, "is_header", "header"), false),
        description: norm(pick(row, "description", "deskripsi")),
      });
    });

    // Process parents before children so parent_id can resolve within one file.
    items.sort(
      (a, b) =>
        a.code.split(".").length - b.code.split(".").length ||
        a.code.localeCompare(b.code),
    );

    // Seed the code -> _id map with the accounts already in the database.
    const idByCode = new Map();
    const existing = await ChartOfAccountModel.find({ is_delete: { $ne: true } })
      .select("_id code")
      .lean();
    for (const e of existing) idByCode.set(upper(e.code), e._id);

    let inserted = 0;
    let updated = 0;
    for (const it of items) {
      const segments = it.code.split(".");
      const level = segments.length;
      const path = it.code;
      const parentPath = segments.slice(0, -1).join(".");
      const parent_id = parentPath
        ? idByCode.get(upper(parentPath)) || null
        : null;
      const existedBefore = idByCode.has(upper(it.code));
      const doc = await ChartOfAccountModel.findOneAndUpdate(
        { code: it.code },
        {
          $set: {
            name: it.name,
            type: it.type,
            normal_balance: NORMAL_BALANCE_BY_TYPE[it.type] || "DEBIT",
            is_header: it.is_header,
            parent_id,
            level,
            path,
            description: it.description,
          },
          $setOnInsert: { code: it.code },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      idByCode.set(upper(it.code), doc._id);
      if (existedBefore) updated += 1;
      else inserted += 1;
    }

    const summary = {
      total_rows: items.length + errors.length,
      inserted,
      updated,
      skipped: errors.length,
      errors: errors.slice(0, 50),
    };
    res.status(200).json({
      success: true,
      message: `Import 'chart-of-account' finished: ${summary.inserted} created, ${summary.updated} updated, ${summary.skipped} skipped.`,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
};

// Valid item lifecycle statuses (detail_product_items.status).
const ITEM_STATUSES = ["PENDING", "ORDERED", "PARTIAL_RECEIVED", "RECEIVED"];
const itemStatusOr = (row, def) => {
  const s = upper(pick(row, "item_status"));
  return ITEM_STATUSES.includes(s) ? s : def;
};

// Shared body for procurement imports (PR / PO / GR / DO). Every document spans
// several rows (one per product item, header columns merged). Products resolve
// against the master (snapshotting code/name); uom / supplier / warehouse
// resolve to their _id. A document is upserted by its number and its detail
// items in `detail_product_items` are fully replaced.
const importProcurement = async (req, res, opts) => {
  const {
    Model,
    parentField,
    moduleLabel,
    keyKeys,
    noField,
    readHeader,
    buildItem,
    computeTotal,
  } = opts;

  const rows = parseRows(req.file);
  const [products, uomByCode, supByCode, whByCode] = await Promise.all([
    productByCode(),
    codeIndex(UomModel, "code"),
    codeIndex(SupplierModel, "code"),
    codeIndex(WarehouseModel, "code"),
  ]);
  const resolvers = { uomByCode, supByCode, whByCode };

  const records = groupLinedRows(
    rows,
    (row) => readHeader(row, resolvers),
    (row) => {
      const product_code = upper(
        pick(row, "product_code", "product", "kode_produk"),
      );
      if (!product_code) return null;
      return { row, product_code };
    },
    keyKeys,
  );

  let inserted = 0;
  let updated = 0;
  const errors = [];
  for (const rec of records) {
    if (!rec.lines.length) {
      errors.push(`${rec.key}: at least 1 item is required.`);
      continue;
    }
    const items = [];
    let total = 0;
    let bad = null;
    for (const ln of rec.lines) {
      const prod = products.get(ln.product_code);
      if (!prod) {
        bad = `product '${ln.product_code}' not found`;
        break;
      }
      const item = buildItem(ln.row, prod, resolvers, rec.header);
      total += Number(item.subtotal) || 0;
      items.push(item);
    }
    if (bad) {
      errors.push(`${rec.key}: ${bad}.`);
      continue;
    }

    const header = { ...rec.header };
    if (computeTotal) header.total_amount = round2(total);
    const existedBefore = await Model.exists({ [noField]: rec.key });
    const doc = await Model.findOneAndUpdate(
      { [noField]: rec.key },
      { $set: header, $setOnInsert: { [noField]: rec.key } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await DetailProductItemModel.deleteMany({ [parentField]: doc._id });
    await DetailProductItemModel.insertMany(
      items.map((it) => ({ ...it, [parentField]: doc._id })),
    );
    if (existedBefore) updated += 1;
    else inserted += 1;
  }

  const summary = {
    total_rows: records.length,
    inserted,
    updated,
    skipped: errors.length,
    errors: errors.slice(0, 50),
  };
  res.status(200).json({
    success: true,
    message: `Import '${moduleLabel}' finished: ${summary.inserted} created, ${summary.updated} updated, ${summary.skipped} skipped.`,
    data: summary,
  });
};

controller.importPurchaseRequest = (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Import Purchase Request from Excel (.xlsx)'
    #swagger.description = 'Import & upsert Purchase Request by request_no. Each document spans several rows (one per item, header columns merged). Items resolve product_code against the master; total_amount is recomputed.'
    #swagger.consumes = ['multipart/form-data']
    #swagger.parameters['file'] = { in: 'formData', type: 'file', required: true, description: 'Excel .xlsx file' }
  */
  const PR_STATUS = [
    "DRAFT",
    "SUBMITTED",
    "APPROVED",
    "PARTIAL_ORDERED",
    "ORDERED",
    "PARTIAL_RECEIVED",
    "RECEIVED",
    "CLOSED",
  ];
  importProcurement(req, res, {
    Model: PurchaseRequestModel,
    parentField: "purchase_request_id",
    moduleLabel: "purchase-request",
    keyKeys: ["request_no", "no", "number"],
    noField: "request_no",
    computeTotal: true,
    readHeader: (row) => ({
      date: parseDateTime(pick(row, "date", "tanggal")) || new Date(),
      needed_date: parseDateTime(pick(row, "needed_date")),
      requested_by: norm(pick(row, "requested_by")),
      reference: norm(pick(row, "reference", "ref")),
      description: norm(pick(row, "description", "keterangan")),
      status: PR_STATUS.includes(upper(pick(row, "status")))
        ? upper(pick(row, "status"))
        : "DRAFT",
    }),
    buildItem: (row, prod, { uomByCode, supByCode }) => {
      const quantity = num(pick(row, "quantity", "qty"));
      const price = num(pick(row, "price", "harga"));
      return {
        product_id: prod._id,
        product_code: prod.code,
        product_name: prod.name,
        uom_id: uomByCode.get(upper(pick(row, "uom", "unit"))) || null,
        supplier_id: supByCode.get(upper(pick(row, "supplier"))) || null,
        quantity,
        price,
        subtotal: round2(quantity * price),
        status: itemStatusOr(row, "PENDING"),
      };
    },
  }).catch(next);
};

controller.importPurchaseOrder = (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Import Purchase Order from Excel (.xlsx)'
    #swagger.description = 'Import & upsert Purchase Order by order_no. Header supplier + items (product_code resolved) with recomputed total_amount.'
    #swagger.consumes = ['multipart/form-data']
    #swagger.parameters['file'] = { in: 'formData', type: 'file', required: true, description: 'Excel .xlsx file' }
  */
  const PO_STATUS = [
    "DRAFT",
    "SUBMITTED",
    "APPROVED",
    "PARTIAL_RECEIVED",
    "RECEIVED",
    "CLOSED",
  ];
  importProcurement(req, res, {
    Model: PurchaseOrderModel,
    parentField: "purchase_order_id",
    moduleLabel: "purchase-order",
    keyKeys: ["order_no", "no", "number"],
    noField: "order_no",
    computeTotal: true,
    readHeader: (row, { supByCode }) => ({
      date: parseDateTime(pick(row, "date", "tanggal")) || new Date(),
      expected_date: parseDateTime(pick(row, "expected_date")),
      supplier_id: supByCode.get(upper(pick(row, "supplier"))) || null,
      reference: norm(pick(row, "reference", "ref")),
      description: norm(pick(row, "description", "keterangan")),
      status: PO_STATUS.includes(upper(pick(row, "status")))
        ? upper(pick(row, "status"))
        : "DRAFT",
    }),
    buildItem: (row, prod, { uomByCode, supByCode }, header) => {
      const quantity = num(pick(row, "quantity", "qty"));
      const price = num(pick(row, "price", "harga"));
      return {
        product_id: prod._id,
        product_code: prod.code,
        product_name: prod.name,
        uom_id: uomByCode.get(upper(pick(row, "uom", "unit"))) || null,
        supplier_id:
          supByCode.get(upper(pick(row, "supplier"))) ||
          header.supplier_id ||
          null,
        quantity,
        price,
        subtotal: round2(quantity * price),
        status: itemStatusOr(row, "ORDERED"),
      };
    },
  }).catch(next);
};

controller.importGoodReceipt = (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Import Good Receipt from Excel (.xlsx)'
    #swagger.description = 'Import & upsert Good Receipt by receipt_no. Items resolve product_code + per-item warehouse (item_warehouse) with received_qty; total_amount recomputed. Note: this does NOT post stock movements.'
    #swagger.consumes = ['multipart/form-data']
    #swagger.parameters['file'] = { in: 'formData', type: 'file', required: true, description: 'Excel .xlsx file' }
  */
  const GR_STATUS = ["DRAFT", "PARTIAL", "RECEIVED"];
  importProcurement(req, res, {
    Model: GoodReceiptModel,
    parentField: "good_receipt_id",
    moduleLabel: "good-receipt",
    keyKeys: ["receipt_no", "no", "number"],
    noField: "receipt_no",
    computeTotal: true,
    readHeader: (row, { whByCode }) => ({
      date: parseDateTime(pick(row, "date", "tanggal")) || new Date(),
      received_date: parseDateTime(pick(row, "received_date")),
      warehouse_id: whByCode.get(upper(pick(row, "warehouse"))) || null,
      warehouse_mode: ["SINGLE", "MULTIPLE"].includes(
        upper(pick(row, "warehouse_mode")),
      )
        ? upper(pick(row, "warehouse_mode"))
        : "SINGLE",
      reference: norm(pick(row, "reference", "ref")),
      description: norm(pick(row, "description", "keterangan")),
      status: GR_STATUS.includes(upper(pick(row, "status")))
        ? upper(pick(row, "status"))
        : "DRAFT",
    }),
    buildItem: (row, prod, { uomByCode, whByCode }, header) => {
      const quantity = num(pick(row, "quantity", "qty"));
      const received_qty = num(pick(row, "received_qty", "received"));
      const price = num(pick(row, "price", "harga"));
      return {
        product_id: prod._id,
        product_code: prod.code,
        product_name: prod.name,
        uom_id: uomByCode.get(upper(pick(row, "uom", "unit"))) || null,
        warehouse_id:
          whByCode.get(upper(pick(row, "item_warehouse", "warehouse"))) ||
          header.warehouse_id ||
          null,
        quantity,
        received_qty,
        price,
        subtotal: round2(quantity * price),
        status: itemStatusOr(row, "RECEIVED"),
      };
    },
  }).catch(next);
};

controller.importDeliveryOrder = (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Import Delivery Order from Excel (.xlsx)'
    #swagger.description = 'Import & upsert Delivery Order by delivery_no. Items resolve product_code + quantity. Note: this does NOT ship or reduce stock.'
    #swagger.consumes = ['multipart/form-data']
    #swagger.parameters['file'] = { in: 'formData', type: 'file', required: true, description: 'Excel .xlsx file' }
  */
  const DO_STATUS = ["PENDING", "SHIPPED"];
  importProcurement(req, res, {
    Model: DeliveryOrderModel,
    parentField: "delivery_order_id",
    moduleLabel: "delivery-order",
    keyKeys: ["delivery_no", "no", "number"],
    noField: "delivery_no",
    computeTotal: false,
    readHeader: (row, { whByCode }) => ({
      date: parseDateTime(pick(row, "date", "tanggal")) || new Date(),
      delivery_date: parseDateTime(pick(row, "delivery_date")),
      recipient: norm(pick(row, "recipient")),
      warehouse_id: whByCode.get(upper(pick(row, "warehouse"))) || null,
      reference: norm(pick(row, "reference", "ref")),
      description: norm(pick(row, "description", "keterangan")),
      status: DO_STATUS.includes(upper(pick(row, "status")))
        ? upper(pick(row, "status"))
        : "PENDING",
    }),
    buildItem: (row, prod, { uomByCode }) => {
      const quantity = num(pick(row, "quantity", "qty"));
      const price = num(pick(row, "price", "harga"));
      return {
        product_id: prod._id,
        product_code: prod.code,
        product_name: prod.name,
        uom_id: uomByCode.get(upper(pick(row, "uom", "unit"))) || null,
        quantity,
        price,
        subtotal: round2(quantity * price),
        status: itemStatusOr(row, "PENDING"),
      };
    },
  }).catch(next);
};

controller.importSupplierPricing = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Import Supplier Pricing from Excel (.xlsx)'
    #swagger.description = 'Import Supplier Pricing. Key = (name + supplier): when a row with the same name AND supplier already exists only its price & is_active are updated; otherwise a new entry is created (no duplicates).'
    #swagger.consumes = ['multipart/form-data']
    #swagger.parameters['file'] = { in: 'formData', type: 'file', required: true, description: 'Excel .xlsx file' }
  */
  try {
    const rows = parseRows(req.file);
    const [uomByCode, supByCode] = await Promise.all([
      codeIndex(UomModel, "code"),
      codeIndex(SupplierModel, "code"),
    ]);

    const seen = new Set();
    const ops = [];
    const errors = [];

    rows.forEach((row, i) => {
      const line = i + 2;
      const name = upper(pick(row, "name", "nama"));
      if (!name) {
        errors.push(`Row ${line}: name is required.`);
        return;
      }
      const uomId = uomByCode.get(upper(pick(row, "uom", "unit")));
      if (!uomId) {
        errors.push(`Row ${line}: uom not found (${name}).`);
        return;
      }
      const supplierId = supByCode.get(upper(pick(row, "supplier"))) || null;

      // Dedup dalam file: kombinasi name + supplier.
      const key = `${name}|${supplierId ? String(supplierId) : ""}`;
      if (seen.has(key)) return;
      seen.add(key);

      const price = num(pick(row, "price", "harga"));
      const is_active = bool(pick(row, "is_active", "aktif"));

      ops.push({
        updateOne: {
          // Name + supplier sama -> update price & status aktif; kalau tidak
          // ada -> buat baru (hindari duplikasi).
          filter: { name, supplier_id: supplierId },
          update: {
            $set: { price, is_active },
            $setOnInsert: {
              name,
              slug: globalService.createSlug(name),
              supplier_id: supplierId,
              uom_id: uomId,
              barcode: norm(pick(row, "barcode")),
            },
          },
          upsert: true,
        },
      });
    });

    const summary = await runBulk(SupplierPricingModel, ops, errors);
    res.status(200).json({
      success: true,
      message: `Import 'supplier-pricing' finished: ${summary.inserted} created, ${summary.updated} updated, ${summary.skipped} skipped.`,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
};

// ============================================================
// EXPORT handlers — one endpoint = one self-contained function. Each builds its
// own query + populate + row map, then applies the shared created_at filter.
// ============================================================

controller.exportProduct = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Export Product as JSON rows'
    #swagger.description = 'Return flattened Product rows filtered by created_at. Frontend builds the Excel. Filter by preset range (7d|1m|1y) OR custom start_date/end_date. Date fields returned as DD/MM/YYYY HH:mm.'
    #swagger.parameters['range'] = { in: 'query', type: 'string', description: '7d | 1m | 1y' }
    #swagger.parameters['start_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range start)' }
    #swagger.parameters['end_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range end)' }
  */
  try {
    const query = ProductModel.find({ is_delete: { $ne: true } })
      .populate("product_category_id", "name prefix")
      .populate("uom_id", "code name");
    const docs = await applyDateFilter(query, req)
      .sort({ created_at: -1 })
      .lean();

    const data = docs.map((d) =>
      formatRowDates({
        code: d.code,
        name: d.name,
        category: refField(d.product_category_id, "name"),
        uom: refField(d.uom_id, "code"),
        purchase_price: d.purchase_price,
        selling_price: d.selling_price,
        barcode: d.barcode,
        description: d.description,
        is_active: d.is_active,
        created_at: d.created_at,
      }),
    );

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: data.length,
    });
  } catch (err) {
    next(err);
  }
};

controller.exportProductCategory = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Export Product Category as JSON rows'
    #swagger.description = 'Return flattened Product Category rows filtered by created_at. Date fields returned as DD/MM/YYYY HH:mm.'
    #swagger.parameters['range'] = { in: 'query', type: 'string', description: '7d | 1m | 1y' }
    #swagger.parameters['start_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range start)' }
    #swagger.parameters['end_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range end)' }
  */
  try {
    const query = ProductCategoryModel.find({ is_delete: { $ne: true } });
    const docs = await applyDateFilter(query, req)
      .sort({ created_at: -1 })
      .lean();

    const data = docs.map((d) =>
      formatRowDates({
        prefix: d.prefix,
        name: d.name,
        is_active: d.is_active,
        created_at: d.created_at,
      }),
    );

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: data.length,
    });
  } catch (err) {
    next(err);
  }
};

controller.exportUom = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Export UOM as JSON rows'
    #swagger.description = 'Return flattened UOM rows filtered by created_at. Date fields returned as DD/MM/YYYY HH:mm.'
    #swagger.parameters['range'] = { in: 'query', type: 'string', description: '7d | 1m | 1y' }
    #swagger.parameters['start_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range start)' }
    #swagger.parameters['end_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range end)' }
  */
  try {
    const query = UomModel.find({ is_delete: { $ne: true } });
    const docs = await applyDateFilter(query, req)
      .sort({ created_at: -1 })
      .lean();

    const data = docs.map((d) =>
      formatRowDates({
        code: d.code,
        name: d.name,
        description: d.description,
        is_active: d.is_active,
        created_at: d.created_at,
      }),
    );

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: data.length,
    });
  } catch (err) {
    next(err);
  }
};

controller.exportWarehouse = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Export Warehouse as JSON rows'
    #swagger.description = 'Return flattened Warehouse rows filtered by created_at. Date fields returned as DD/MM/YYYY HH:mm.'
    #swagger.parameters['range'] = { in: 'query', type: 'string', description: '7d | 1m | 1y' }
    #swagger.parameters['start_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range start)' }
    #swagger.parameters['end_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range end)' }
  */
  try {
    const query = WarehouseModel.find({ is_delete: { $ne: true } });
    const docs = await applyDateFilter(query, req)
      .sort({ created_at: -1 })
      .lean();

    const data = docs.map((d) =>
      formatRowDates({
        code: d.code,
        name: d.name,
        phone: d.phone,
        street: d.address?.street ?? "",
        city: d.address?.city ?? "",
        state_province: d.address?.state_province ?? "",
        postal_code: d.address?.postal_code ?? "",
        country: d.address?.country ?? "",
        is_active: d.is_active,
        created_at: d.created_at,
      }),
    );

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: data.length,
    });
  } catch (err) {
    next(err);
  }
};

controller.exportSupplier = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Export Supplier as JSON rows'
    #swagger.description = 'Return flattened Supplier rows filtered by created_at. Date fields returned as DD/MM/YYYY HH:mm.'
    #swagger.parameters['range'] = { in: 'query', type: 'string', description: '7d | 1m | 1y' }
    #swagger.parameters['start_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range start)' }
    #swagger.parameters['end_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range end)' }
  */
  try {
    const query = SupplierModel.find({ is_delete: { $ne: true } });
    const docs = await applyDateFilter(query, req)
      .sort({ created_at: -1 })
      .lean();

    const data = docs.map((d) =>
      formatRowDates({
        code: d.code,
        name: d.name,
        phone: (d.contact_info?.phone ?? []).join(", "),
        email: d.contact_info?.email ?? "",
        contact_person: d.contact_info?.contact_person ?? "",
        city: d.address?.city ?? "",
        is_active: d.is_active,
        created_at: d.created_at,
      }),
    );

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: data.length,
    });
  } catch (err) {
    next(err);
  }
};

controller.exportStockPosition = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Export Stock Position as JSON rows'
    #swagger.description = 'Return flattened Stock Position rows filtered by created_at. Date fields returned as DD/MM/YYYY HH:mm.'
    #swagger.parameters['range'] = { in: 'query', type: 'string', description: '7d | 1m | 1y' }
    #swagger.parameters['start_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range start)' }
    #swagger.parameters['end_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range end)' }
  */
  try {
    const query = StockPositionModel.find({ is_delete: { $ne: true } })
      .populate("product_id", "code name")
      .populate("warehouse_id", "code name")
      .populate("uom_id", "code");
    const docs = await applyDateFilter(query, req)
      .sort({ created_at: -1 })
      .lean();

    const data = docs.map((d) =>
      formatRowDates({
        product: refField(d.product_id, "code"),
        product_name: refField(d.product_id, "name"),
        warehouse: refField(d.warehouse_id, "code"),
        uom: refField(d.uom_id, "code"),
        quantity: d.quantity,
        reserved_quantity: d.reserved_quantity,
        created_at: d.created_at,
      }),
    );

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: data.length,
    });
  } catch (err) {
    next(err);
  }
};

controller.exportStockMovement = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Export Stock Movement as JSON rows'
    #swagger.description = 'Return flattened Stock Movement rows filtered by created_at. Date fields returned as DD/MM/YYYY HH:mm.'
    #swagger.parameters['range'] = { in: 'query', type: 'string', description: '7d | 1m | 1y' }
    #swagger.parameters['start_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range start)' }
    #swagger.parameters['end_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range end)' }
  */
  try {
    const query = StockMovementModel.find({ is_delete: { $ne: true } })
      .populate("product_id", "code name")
      .populate("warehouse_id", "code name")
      .populate("uom_id", "code");
    const docs = await applyDateFilter(query, req)
      .sort({ created_at: -1 })
      .lean();

    const data = docs.map((d) =>
      formatRowDates({
        product: refField(d.product_id, "code"),
        warehouse: refField(d.warehouse_id, "code"),
        uom: refField(d.uom_id, "code"),
        type: d.type,
        status: d.status,
        quantity: d.quantity,
        reference: d.reference,
        date: d.date,
        note: d.note,
        created_at: d.created_at,
      }),
    );

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: data.length,
    });
  } catch (err) {
    next(err);
  }
};

controller.exportPurchaseRequest = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Export Purchase Request as JSON rows'
    #swagger.description = 'Return flattened Purchase Request rows filtered by created_at. Date fields returned as DD/MM/YYYY HH:mm.'
    #swagger.parameters['range'] = { in: 'query', type: 'string', description: '7d | 1m | 1y' }
    #swagger.parameters['start_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range start)' }
    #swagger.parameters['end_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range end)' }
  */
  try {
    const query = PurchaseRequestModel.find({ is_delete: { $ne: true } });
    const docs = await applyDateFilter(query, req)
      .sort({ created_at: -1 })
      .lean();
    const byParent = await itemsByParent(
      "purchase_request_id",
      docs.map((d) => d._id),
    );

    const data = docs.map((d) =>
      formatRowDates({
        request_no: d.request_no,
        date: d.date,
        needed_date: d.needed_date,
        requested_by: d.requested_by,
        reference: d.reference,
        description: d.description,
        status: d.status,
        total_amount: d.total_amount,
        items: (byParent.get(String(d._id)) || []).map((it) => ({
          product_code: it.product_code,
          product_name: it.product_name,
          uom: refField(it.uom_id, "code"),
          quantity: it.quantity,
          price: it.price,
          subtotal: it.subtotal,
          item_status: it.status,
        })),
        created_at: d.created_at,
      }),
    );

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: data.length,
    });
  } catch (err) {
    next(err);
  }
};

controller.exportPurchaseOrder = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Export Purchase Order as JSON rows'
    #swagger.description = 'Return flattened Purchase Order rows filtered by created_at. Date fields returned as DD/MM/YYYY HH:mm.'
    #swagger.parameters['range'] = { in: 'query', type: 'string', description: '7d | 1m | 1y' }
    #swagger.parameters['start_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range start)' }
    #swagger.parameters['end_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range end)' }
  */
  try {
    const query = PurchaseOrderModel.find({ is_delete: { $ne: true } }).populate(
      "supplier_id",
      "code name",
    );
    const docs = await applyDateFilter(query, req)
      .sort({ created_at: -1 })
      .lean();
    const byParent = await itemsByParent(
      "purchase_order_id",
      docs.map((d) => d._id),
    );

    const data = docs.map((d) =>
      formatRowDates({
        order_no: d.order_no,
        date: d.date,
        expected_date: d.expected_date,
        supplier: refField(d.supplier_id, "code"),
        reference: d.reference,
        description: d.description,
        status: d.status,
        total_amount: d.total_amount,
        items: (byParent.get(String(d._id)) || []).map((it) => ({
          product_code: it.product_code,
          product_name: it.product_name,
          uom: refField(it.uom_id, "code"),
          quantity: it.quantity,
          price: it.price,
          subtotal: it.subtotal,
          item_status: it.status,
        })),
        created_at: d.created_at,
      }),
    );

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: data.length,
    });
  } catch (err) {
    next(err);
  }
};

controller.exportGoodReceipt = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Export Good Receipt as JSON rows'
    #swagger.description = 'Return flattened Good Receipt rows filtered by created_at. Date fields returned as DD/MM/YYYY HH:mm.'
    #swagger.parameters['range'] = { in: 'query', type: 'string', description: '7d | 1m | 1y' }
    #swagger.parameters['start_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range start)' }
    #swagger.parameters['end_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range end)' }
  */
  try {
    const query = GoodReceiptModel.find({ is_delete: { $ne: true } }).populate(
      "warehouse_id",
      "code name",
    );
    const docs = await applyDateFilter(query, req)
      .sort({ created_at: -1 })
      .lean();
    const byParent = await itemsByParent(
      "good_receipt_id",
      docs.map((d) => d._id),
    );

    const data = docs.map((d) =>
      formatRowDates({
        receipt_no: d.receipt_no,
        date: d.date,
        received_date: d.received_date,
        warehouse: refField(d.warehouse_id, "code"),
        warehouse_mode: d.warehouse_mode,
        reference: d.reference,
        description: d.description,
        status: d.status,
        total_amount: d.total_amount,
        items: (byParent.get(String(d._id)) || []).map((it) => ({
          product_code: it.product_code,
          product_name: it.product_name,
          uom: refField(it.uom_id, "code"),
          item_warehouse: refField(it.warehouse_id, "code"),
          quantity: it.quantity,
          received_qty: it.received_qty,
          price: it.price,
          subtotal: it.subtotal,
          item_status: it.status,
        })),
        created_at: d.created_at,
      }),
    );

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: data.length,
    });
  } catch (err) {
    next(err);
  }
};

controller.exportDeliveryOrder = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Export Delivery Order as JSON rows'
    #swagger.description = 'Return flattened Delivery Order rows filtered by created_at. Date fields returned as DD/MM/YYYY HH:mm.'
    #swagger.parameters['range'] = { in: 'query', type: 'string', description: '7d | 1m | 1y' }
    #swagger.parameters['start_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range start)' }
    #swagger.parameters['end_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range end)' }
  */
  try {
    const query = DeliveryOrderModel.find({ is_delete: { $ne: true } }).populate(
      "warehouse_id",
      "code name",
    );
    const docs = await applyDateFilter(query, req)
      .sort({ created_at: -1 })
      .lean();
    const byParent = await itemsByParent(
      "delivery_order_id",
      docs.map((d) => d._id),
    );

    const data = docs.map((d) =>
      formatRowDates({
        delivery_no: d.delivery_no,
        date: d.date,
        delivery_date: d.delivery_date,
        recipient: d.recipient,
        warehouse: refField(d.warehouse_id, "code"),
        reference: d.reference,
        description: d.description,
        status: d.status,
        items: (byParent.get(String(d._id)) || []).map((it) => ({
          product_code: it.product_code,
          product_name: it.product_name,
          uom: refField(it.uom_id, "code"),
          quantity: it.quantity,
          price: it.price,
          subtotal: it.subtotal,
          item_status: it.status,
        })),
        created_at: d.created_at,
      }),
    );

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: data.length,
    });
  } catch (err) {
    next(err);
  }
};

// ---- FINANCE exports. Line-based modules keep their account lines as an
// `accounts` array so the frontend can expand them into rows and vertically
// merge the header columns. Chart of Account is flat (no account array).

controller.exportJournalEntry = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Export Journal Entry as JSON rows'
    #swagger.description = 'Return Journal Entry documents filtered by created_at. Each row keeps its `accounts` array (account_code, account_name, account_description, debit, credit) so the frontend can merge the header cells across the account rows. Date fields returned as DD/MM/YYYY (created_at as DD/MM/YYYY HH:mm).'
    #swagger.parameters['range'] = { in: 'query', type: 'string', description: '7d | 1m | 1y' }
    #swagger.parameters['start_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range start)' }
    #swagger.parameters['end_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range end)' }
  */
  try {
    const query = JournalEntryModel.find({ is_delete: { $ne: true } });
    const docs = await applyDateFilter(query, req)
      .sort({ created_at: -1 })
      .lean();

    const data = docs.map((d) =>
      formatRowDates({
        entry_no: d.entry_no,
        date: d.date,
        description: d.description,
        reference: d.reference,
        status: d.status,
        total_debit: d.total_debit,
        total_credit: d.total_credit,
        accounts: (d.lines || []).map((ln) => ({
          account_code: ln.account_code,
          account_name: ln.account_name,
          account_description: ln.description,
          debit: ln.debit,
          credit: ln.credit,
        })),
        created_at: d.created_at,
      }),
    );

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: data.length,
    });
  } catch (err) {
    next(err);
  }
};

controller.exportJournalWriteOff = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Export Journal Write-Off as JSON rows'
    #swagger.description = 'Return Journal Write-Off documents filtered by created_at. Keeps the `accounts` array (debit/credit) for header-cell merging. Date fields DD/MM/YYYY (created_at DD/MM/YYYY HH:mm).'
    #swagger.parameters['range'] = { in: 'query', type: 'string', description: '7d | 1m | 1y' }
    #swagger.parameters['start_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range start)' }
    #swagger.parameters['end_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range end)' }
  */
  try {
    const query = JournalWriteOffModel.find({ is_delete: { $ne: true } });
    const docs = await applyDateFilter(query, req)
      .sort({ created_at: -1 })
      .lean();

    const data = docs.map((d) =>
      formatRowDates({
        entry_no: d.entry_no,
        date: d.date,
        write_off_type: d.write_off_type,
        reference: d.reference,
        description: d.description,
        source_type: d.source_type,
        source_no: d.source_no,
        status: d.status,
        total_debit: d.total_debit,
        total_credit: d.total_credit,
        accounts: (d.lines || []).map((ln) => ({
          account_code: ln.account_code,
          account_name: ln.account_name,
          account_description: ln.description,
          debit: ln.debit,
          credit: ln.credit,
        })),
        created_at: d.created_at,
      }),
    );

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: data.length,
    });
  } catch (err) {
    next(err);
  }
};

controller.exportAccountReceivable = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Export Account Receivable as JSON rows'
    #swagger.description = 'Return Account Receivable documents filtered by created_at. Keeps the `accounts` array (amount) for header-cell merging. Date fields DD/MM/YYYY (created_at DD/MM/YYYY HH:mm).'
    #swagger.parameters['range'] = { in: 'query', type: 'string', description: '7d | 1m | 1y' }
    #swagger.parameters['start_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range start)' }
    #swagger.parameters['end_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range end)' }
  */
  try {
    const query = AccountReceivableModel.find({ is_delete: { $ne: true } });
    const docs = await applyDateFilter(query, req)
      .sort({ created_at: -1 })
      .lean();

    const data = docs.map((d) =>
      formatRowDates({
        entry_no: d.entry_no,
        date: d.date,
        due_date: d.due_date,
        party_name: d.party_name,
        reference: d.reference,
        description: d.description,
        status: d.status,
        total_amount: d.total_amount,
        paid_amount: d.paid_amount,
        total_remaining: d.total_remaining,
        accounts: (d.lines || []).map((ln) => ({
          account_code: ln.account_code,
          account_name: ln.account_name,
          account_description: ln.description,
          amount: ln.amount,
        })),
        created_at: d.created_at,
      }),
    );

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: data.length,
    });
  } catch (err) {
    next(err);
  }
};

controller.exportAccountPayable = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Export Account Payable as JSON rows'
    #swagger.description = 'Return Account Payable documents filtered by created_at. Keeps the `accounts` array (amount) for header-cell merging. Date fields DD/MM/YYYY (created_at DD/MM/YYYY HH:mm).'
    #swagger.parameters['range'] = { in: 'query', type: 'string', description: '7d | 1m | 1y' }
    #swagger.parameters['start_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range start)' }
    #swagger.parameters['end_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range end)' }
  */
  try {
    const query = AccountPayableModel.find({ is_delete: { $ne: true } });
    const docs = await applyDateFilter(query, req)
      .sort({ created_at: -1 })
      .lean();

    const data = docs.map((d) =>
      formatRowDates({
        entry_no: d.entry_no,
        date: d.date,
        due_date: d.due_date,
        party_name: d.party_name,
        reference: d.reference,
        description: d.description,
        status: d.status,
        total_amount: d.total_amount,
        paid_amount: d.paid_amount,
        total_remaining: d.total_remaining,
        accounts: (d.lines || []).map((ln) => ({
          account_code: ln.account_code,
          account_name: ln.account_name,
          account_description: ln.description,
          amount: ln.amount,
        })),
        created_at: d.created_at,
      }),
    );

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: data.length,
    });
  } catch (err) {
    next(err);
  }
};

controller.exportChartOfAccount = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Export Chart of Account as JSON rows'
    #swagger.description = 'Return flattened Chart of Account rows filtered by created_at (no account array). `code` is the materialized path; parent_code is the parent account code. Date fields DD/MM/YYYY (created_at DD/MM/YYYY HH:mm).'
    #swagger.parameters['range'] = { in: 'query', type: 'string', description: '7d | 1m | 1y' }
    #swagger.parameters['start_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range start)' }
    #swagger.parameters['end_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range end)' }
  */
  try {
    const query = ChartOfAccountModel.find({ is_delete: { $ne: true } }).populate(
      "parent_id",
      "code name",
    );
    const docs = await applyDateFilter(query, req)
      .sort({ created_at: -1 })
      .lean();

    const data = docs.map((d) =>
      formatRowDates({
        code: d.code,
        name: d.name,
        type: d.type,
        normal_balance: d.normal_balance,
        is_header: d.is_header,
        parent_code: refField(d.parent_id, "code"),
        level: d.level,
        description: d.description,
        created_at: d.created_at,
      }),
    );

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: data.length,
    });
  } catch (err) {
    next(err);
  }
};

controller.exportSupplierPricing = async (req, res, next) => {
  /*
    #swagger.tags = ['Export Import']
    #swagger.summary = 'Export Supplier Pricing as JSON rows'
    #swagger.description = 'Return flattened Supplier Pricing rows filtered by created_at. Date fields DD/MM/YYYY (created_at DD/MM/YYYY HH:mm).'
    #swagger.parameters['range'] = { in: 'query', type: 'string', description: '7d | 1m | 1y' }
    #swagger.parameters['start_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range start)' }
    #swagger.parameters['end_date'] = { in: 'query', type: 'string', description: 'ISO date (custom range end)' }
  */
  try {
    const query = SupplierPricingModel.find({ is_delete: { $ne: true } })
      .populate("supplier_id", "code name")
      .populate("uom_id", "code name");
    const docs = await applyDateFilter(query, req)
      .sort({ created_at: -1 })
      .lean();

    const data = docs.map((d) =>
      formatRowDates({
        name: d.name,
        supplier: refField(d.supplier_id, "code"),
        uom: refField(d.uom_id, "code"),
        barcode: d.barcode,
        price: d.price,
        is_active: d.is_active,
        created_at: d.created_at,
      }),
    );

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: data.length,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = controller;
