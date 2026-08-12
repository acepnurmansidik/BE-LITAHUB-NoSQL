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

    // Resolve category / uom / supplier codes to their _id up front.
    const [catByPrefix, catByName, uomByCode, supByCode] = await Promise.all([
      codeIndex(ProductCategoryModel, "prefix"),
      codeIndex(ProductCategoryModel, "name"),
      codeIndex(UomModel, "code"),
      codeIndex(SupplierModel, "code"),
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
      const supplierId = supByCode.get(upper(pick(row, "supplier"))) || null;
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
              supplier_id: supplierId,
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
      .populate("uom_id", "code name")
      .populate("supplier_id", "code name");
    const docs = await applyDateFilter(query, req)
      .sort({ created_at: -1 })
      .lean();

    const data = docs.map((d) =>
      formatRowDates({
        code: d.code,
        name: d.name,
        category: refField(d.product_category_id, "name"),
        uom: refField(d.uom_id, "code"),
        supplier: refField(d.supplier_id, "code"),
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

    const data = docs.map((d) =>
      formatRowDates({
        request_no: d.request_no,
        date: d.date,
        needed_date: d.needed_date,
        status: d.status,
        total_amount: d.total_amount,
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

    const data = docs.map((d) =>
      formatRowDates({
        order_no: d.order_no,
        date: d.date,
        expected_date: d.expected_date,
        supplier: refField(d.supplier_id, "name"),
        status: d.status,
        total_amount: d.total_amount,
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

    const data = docs.map((d) =>
      formatRowDates({
        receipt_no: d.receipt_no,
        date: d.date,
        warehouse: refField(d.warehouse_id, "name"),
        status: d.status,
        total_amount: d.total_amount,
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

    const data = docs.map((d) =>
      formatRowDates({
        delivery_no: d.delivery_no,
        date: d.date,
        delivery_date: d.delivery_date,
        recipient: d.recipient,
        warehouse: refField(d.warehouse_id, "name"),
        status: d.status,
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
