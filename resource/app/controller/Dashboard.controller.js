// ============================================================
// DASHBOARD — ringkasan per modul (Procurement / Finance / Inventory).
// SATU endpoint + SATU function; hasilnya di-cache di Redis dengan masa
// kadaluarsa 3 jam (getOrSetCache). Data hanya berupa agregasi ringan (jumlah
// per status, dsb) sehingga aman di-cache.
// ============================================================

const { getOrSetCache } = require("../../helper/redis-cache");

const PurchaseRequestModel = require("../models/PurchaseRequest.model");
const PurchaseOrderModel = require("../models/PurchaseOrder.model");
const GoodReceiptModel = require("../models/GoodReceipt.model");
const DeliveryOrderModel = require("../models/DeliveryOrder.model");
const JournalEntryModel = require("../models/JournalEntry.model");
const JournalWriteOffModel = require("../models/JournalWriteOff.model");
const AccountReceivableModel = require("../models/AccountReceivable.model");
const AccountPayableModel = require("../models/AccountPayable.model");
const ChartOfAccountModel = require("../models/ChartOfAccount.model");
const ProductModel = require("../models/Product.model");
const ProductCategoryModel = require("../models/ProductCategory.model");
const UomModel = require("../models/Uom.model");
const WarehouseModel = require("../models/Warehouse.model");
const SupplierModel = require("../models/Supplier.model");
const SupplierPricingModel = require("../models/SupplierPricing.model");
const StockPositionModel = require("../models/StockPosition.model");
const StockMovementModel = require("../models/StockMovement.model");

const controller = {};

const THREE_HOURS = 3 * 60 * 60; // detik
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Jumlah dokumen per `status` (+ opsi menjumlahkan beberapa field numerik).
const statusAgg = async (Model, sumFields = []) => {
  const sumSpec = {};
  for (const f of sumFields) sumSpec[f] = { $sum: `$${f}` };
  const rows = await Model.aggregate([
    { $match: { is_delete: { $ne: true } } },
    { $group: { _id: "$status", count: { $sum: 1 }, ...sumSpec } },
  ]);
  const by_status = {};
  const totals = {};
  for (const f of sumFields) totals[f] = 0;
  let total = 0;
  for (const r of rows) {
    const key = r._id || "UNKNOWN";
    by_status[key] = r.count;
    total += r.count;
    for (const f of sumFields) totals[f] += r[f] || 0;
  }
  const out = { total, by_status };
  for (const f of sumFields) out[f] = round2(totals[f]);
  return out;
};

// Jumlah dokumen aktif / non-aktif (is_active).
const activeAgg = async (Model) => {
  const rows = await Model.aggregate([
    { $match: { is_delete: { $ne: true } } },
    { $group: { _id: "$is_active", count: { $sum: 1 } } },
  ]);
  let active = 0;
  let inactive = 0;
  for (const r of rows) {
    if (r._id) active += r.count;
    else inactive += r.count;
  }
  return { total: active + inactive, active, inactive };
};

// Jumlah dokumen per sebuah field kategori (mis. type).
const groupAgg = async (Model, field) => {
  const rows = await Model.aggregate([
    { $match: { is_delete: { $ne: true } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
  ]);
  const by = {};
  let total = 0;
  for (const r of rows) {
    by[r._id || "UNKNOWN"] = r.count;
    total += r.count;
  }
  return { total, by };
};

// Ringkasan stock position: jumlah baris + total kuantitas.
const stockPositionAgg = async () => {
  const rows = await StockPositionModel.aggregate([
    { $match: { is_delete: { $ne: true } } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        total_quantity: { $sum: "$quantity" },
      },
    },
  ]);
  const r = rows[0];
  return r
    ? { total: r.total, total_quantity: round2(r.total_quantity) }
    : { total: 0, total_quantity: 0 };
};

// Pemasukan & pengeluaran dari Journal Entry yang POSTED. Tiap baris jurnal
// ditautkan ke Chart of Account untuk mengetahui tipe akunnya:
//   income  (pemasukan)  = Σ(credit - debit) pada akun pendapatan,
//   expense (pengeluaran)= Σ(debit - credit) pada akun beban.
// Disertai deret 6 bulan terakhir untuk grafik tren.
const INCOME_TYPES = ["REVENUE", "SALES", "OTHER_INCOME_EXPENSE"];
const EXPENSE_TYPES = [
  "EXPENSE",
  "COGS",
  "ADM_OPERATION_EXPENSE",
  "DEPRECIATION_AMORTIZATION",
];
const cashFlow = async () => {
  const coaColl = ChartOfAccountModel.collection.collectionName;
  const rows = await JournalEntryModel.aggregate([
    { $match: { is_delete: { $ne: true }, status: "POSTED" } },
    { $unwind: "$lines" },
    {
      $lookup: {
        from: coaColl,
        localField: "lines.account_id",
        foreignField: "_id",
        as: "acc",
      },
    },
    { $unwind: "$acc" },
    {
      $group: {
        _id: {
          y: { $year: "$date" },
          m: { $month: "$date" },
          type: "$acc.type",
        },
        debit: { $sum: "$lines.debit" },
        credit: { $sum: "$lines.credit" },
      },
    },
  ]);

  const monthlyMap = new Map(); // "YYYY-MM" -> { income, expense }
  let income = 0;
  let expense = 0;
  for (const r of rows) {
    const t = r._id.type;
    const key = `${r._id.y}-${String(r._id.m).padStart(2, "0")}`;
    if (!monthlyMap.has(key)) monthlyMap.set(key, { income: 0, expense: 0 });
    const bucket = monthlyMap.get(key);
    if (INCOME_TYPES.includes(t)) {
      const v = (r.credit || 0) - (r.debit || 0);
      income += v;
      bucket.income += v;
    } else if (EXPENSE_TYPES.includes(t)) {
      const v = (r.debit || 0) - (r.credit || 0);
      expense += v;
      bucket.expense += v;
    }
  }

  // Deret 6 bulan terakhir (termasuk bulan berjalan).
  const now = new Date();
  const monthly = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = monthlyMap.get(key) || { income: 0, expense: 0 };
    monthly.push({
      month: key,
      income: round2(b.income),
      expense: round2(b.expense),
    });
  }

  return {
    income: round2(income),
    expense: round2(expense),
    net: round2(income - expense),
    monthly,
  };
};

// ============================================================
// Handlers — satu endpoint = satu function; hasil di-cache 3 jam.
// ============================================================

controller.procurement = async (req, res, next) => {
  /*
    #swagger.tags = ['Dashboard']
    #swagger.summary = 'Procurement dashboard summary'
    #swagger.description = 'Jumlah PR/PO/GR/DO per status (+ total_amount). Cache Redis 3 jam.'
  */
  try {
    const data = await getOrSetCache({
      key: "dashboard:procurement",
      expiry: THREE_HOURS,
      fetchFunction: async () => ({
        purchase_request: await statusAgg(PurchaseRequestModel, [
          "total_amount",
        ]),
        purchase_order: await statusAgg(PurchaseOrderModel, ["total_amount"]),
        good_receipt: await statusAgg(GoodReceiptModel, ["total_amount"]),
        delivery_order: await statusAgg(DeliveryOrderModel),
      }),
    });
    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
    });
  } catch (err) {
    next(err);
  }
};

controller.finance = async (req, res, next) => {
  /*
    #swagger.tags = ['Dashboard']
    #swagger.summary = 'Finance dashboard summary'
    #swagger.description = 'Jumlah JE/Write-Off/AR/AP per status + Chart of Account per tipe + cash flow (pemasukan/pengeluaran) dari jurnal POSTED. Cache Redis 3 jam.'
  */
  try {
    const data = await getOrSetCache({
      key: "dashboard:finance",
      expiry: THREE_HOURS,
      fetchFunction: async () => ({
        journal_entry: await statusAgg(JournalEntryModel),
        journal_write_off: await statusAgg(JournalWriteOffModel),
        account_receivable: await statusAgg(AccountReceivableModel, [
          "total_amount",
          "paid_amount",
          "total_remaining",
        ]),
        account_payable: await statusAgg(AccountPayableModel, [
          "total_amount",
          "paid_amount",
          "total_remaining",
        ]),
        chart_of_account: await groupAgg(ChartOfAccountModel, "type"),
        cash_flow: await cashFlow(),
      }),
    });
    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
    });
  } catch (err) {
    next(err);
  }
};

controller.inventory = async (req, res, next) => {
  /*
    #swagger.tags = ['Dashboard']
    #swagger.summary = 'Inventory dashboard summary'
    #swagger.description = 'Jumlah produk/kategori/uom/warehouse/supplier/supplier-pricing (aktif vs non-aktif), stock position, & stock movement per status/tipe. Cache Redis 3 jam.'
  */
  try {
    const data = await getOrSetCache({
      key: "dashboard:inventory",
      expiry: THREE_HOURS,
      fetchFunction: async () => {
        const stockMovement = await statusAgg(StockMovementModel);
        const byType = await groupAgg(StockMovementModel, "type");
        return {
          product: await activeAgg(ProductModel),
          product_category: await activeAgg(ProductCategoryModel),
          uom: await activeAgg(UomModel),
          warehouse: await activeAgg(WarehouseModel),
          supplier: await activeAgg(SupplierModel),
          supplier_pricing: await activeAgg(SupplierPricingModel),
          stock_position: await stockPositionAgg(),
          stock_movement: { ...stockMovement, by_type: byType.by },
        };
      },
    });
    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = controller;
