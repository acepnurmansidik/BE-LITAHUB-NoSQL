const ProductModel = require("../app/models/Product.model");
const DetailProductItemModel = require("../app/models/DetailProductItem.model");
const StockMovementModel = require("../app/models/StockMovement.model");
const StockPositionModel = require("../app/models/StockPosition.model");
const GoodReceiptModel = require("../app/models/GoodReceipt.model");
const BadRequest = require("../utils/errors/bad-request");
const PurchaseOrderModel = require("../app/models/PurchaseOrder.model");
const PurchaseRequestModel = require("../app/models/PurchaseRequest.model");

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Valid parent fields — tiap baris item hanya menempel ke satu parent.
const PARENT_FIELDS = [
  "purchase_request_id",
  "purchase_order_id",
  "good_receipt_id",
];

// Validasi & normalisasi baris item. Tiap baris wajib menunjuk product yang
// ada. UOM diambil dari raw.uom_id, atau default dari master product bila
// kosong. Kode/nama product di-snapshot; subtotal = qty * price.
// opts.noDuplicate = true  -> tolak produk yang sama dalam satu dokumen (PR).
// Mengembalikan { items, total }.
const buildDetailProductItems = async (rawItems, session, opts = {}) => {
  const { noDuplicate = false } = opts;
  if (!Array.isArray(rawItems) || rawItems.length < 1) {
    throw new BadRequest("At least 1 item is required.");
  }

  if (noDuplicate) {
    const seen = new Set();
    for (const raw of rawItems) {
      const pid = String(raw && raw.product_id);
      if (seen.has(pid)) {
        throw new BadRequest(
          "Duplicate product is not allowed in one document.",
        );
      }
      seen.add(pid);
    }
  }

  const productIds = [
    ...new Set(
      rawItems
        .map((it) => it && it.product_id)
        .filter(Boolean)
        .map(String),
    ),
  ];

  const products = await ProductModel.find({
    _id: { $in: productIds },
    is_delete: { $ne: true },
  }).session(session ?? null);
  const byId = new Map(products.map((p) => [String(p._id), p]));

  let total = 0;
  const items = rawItems.map((raw, index) => {
    const prod = raw.product_id ? byId.get(String(raw.product_id)) : null;
    if (!prod) throw new BadRequest(`Item ${index + 1}: product not found.`);

    const quantity = round2(raw.quantity);
    if (quantity <= 0) {
      throw new BadRequest(
        `Item ${index + 1}: quantity must be greater than 0.`,
      );
    }
    const price = round2(raw.price);
    if (price < 0) {
      throw new BadRequest(`Item ${index + 1}: price cannot be negative.`);
    }
    const received_qty = Math.max(round2(raw.received_qty), 0);
    const subtotal = round2(quantity * price);
    total += subtotal;

    return {
      product_id: prod._id,
      product_code: prod.code,
      product_name: prod.name,
      // UOM: pakai yang dikirim, atau default UOM master product.
      uom_id: raw.uom_id || prod.uom_id || null,
      supplier_id: raw.supplier_id || null,
      warehouse_id: raw.warehouse_id || null,
      quantity,
      received_qty,
      price,
      subtotal,
    };
  });

  return { items, total: round2(total) };
};

// Ganti seluruh baris item milik sebuah parent (replace-all): hapus item lama
// (hard delete — baris detail, bukan dokumen utama) lalu insert yang baru.
// Dipakai PR & GR (item milik sendiri). `parentField` salah satu PARENT_FIELDS.
const syncDetailProductItems = async ({
  parentField,
  parentId,
  items,
  session,
}) => {
  if (!PARENT_FIELDS.includes(parentField)) {
    throw new BadRequest(`Invalid parent field: ${parentField}`);
  }

  await DetailProductItemModel.deleteMany({ [parentField]: parentId }).session(
    session ?? null,
  );

  if (!items || items.length < 1) return [];

  const docs = items.map((it) => ({ ...it, [parentField]: parentId }));
  return DetailProductItemModel.insertMany(docs, {
    session: session ?? null,
    ordered: true,
  });
};

// ============================================================
// PURCHASE ORDER — sinkron item dengan model "shared doc":
//  - Baris dari PR (punya source_item_ids) TIDAK bikin doc baru; doc PR yang
//    ada di-set purchase_order_id (reuse). Edit qty/price baris single-source
//    ikut mengubah doc (jadi kebawa juga ke PR karena doc-nya sama).
//  - Baris manual (tanpa source_item_ids) = doc baru milik PO.
//  - Baris (PR) yang DIHAPUS dari PO -> doc-nya di-hard delete (otomatis hilang
//    dari PR juga).
// Mengembalikan { total, linkedPrIds }.
// ============================================================
const syncPurchaseOrderItems = async ({ poId, payloadItems, session }) => {
  const s = session ?? null;
  const list = Array.isArray(payloadItems) ? payloadItems : [];

  const manualRaw = list.filter(
    (it) => !Array.isArray(it.source_item_ids) || it.source_item_ids.length < 1,
  );
  const reuseLines = list.filter(
    (it) => Array.isArray(it.source_item_ids) && it.source_item_ids.length > 0,
  );

  // Normalisasi & validasi baris manual (produk harus ada).
  const { items: manualItems } = manualRaw.length
    ? await buildDetailProductItems(manualRaw, s)
    : { items: [] };

  const reuseIds = [
    ...new Set(reuseLines.flatMap((l) => l.source_item_ids.map(String))),
  ];
  // Edit hanya untuk baris single-source (1 detail item).
  const singleEdits = new Map();
  for (const l of reuseLines) {
    if (l.source_item_ids.length === 1) {
      singleEdits.set(String(l.source_item_ids[0]), l);
    }
  }

  // Doc yang saat ini ter-link ke PO ini.
  const existing = await DetailProductItemModel.find({
    purchase_order_id: poId,
  }).session(s);

  // Hapus doc manual lama (milik PO) — akan dibuat ulang.
  const manualExistingIds = existing
    .filter((d) => !d.purchase_request_id)
    .map((d) => d._id);
  if (manualExistingIds.length) {
    await DetailProductItemModel.deleteMany({
      _id: { $in: manualExistingIds },
    }).session(s);
  }

  // Doc dari PR yang dilepas dari PO -> hard delete (cascade ke PR).
  const removedPrDocIds = existing
    .filter((d) => d.purchase_request_id && !reuseIds.includes(String(d._id)))
    .map((d) => d._id);
  if (removedPrDocIds.length) {
    await DetailProductItemModel.deleteMany({
      _id: { $in: removedPrDocIds },
    }).session(s);
  }

  // Link/reuse doc PR ke PO.
  for (const id of reuseIds) {
    const edit = singleEdits.get(id);
    const set = { purchase_order_id: poId };
    if (edit) {
      const q = round2(edit.quantity);
      const p = round2(edit.price);
      set.quantity = q;
      set.price = p;
      set.subtotal = round2(q * p);
      if (edit.uom_id) set.uom_id = edit.uom_id;
      set.supplier_id = edit.supplier_id || null;
    }
    await DetailProductItemModel.updateOne({ _id: id }, { $set: set }).session(
      s,
    );
  }

  // Buat baris manual baru milik PO.
  if (manualItems.length) {
    await DetailProductItemModel.insertMany(
      manualItems.map((it) => ({ ...it, purchase_order_id: poId })),
      { session: s, ordered: true },
    );
  }

  // Total & PR sumber dari seluruh doc yang ter-link.
  const linked = await DetailProductItemModel.find({
    purchase_order_id: poId,
    is_delete: { $ne: true },
  }).session(s);
  const total = round2(
    linked.reduce((a, d) => a + (Number(d.subtotal) || 0), 0),
  );
  const linkedPrIds = [
    ...new Set(
      linked
        .filter((d) => d.purchase_request_id)
        .map((d) => String(d.purchase_request_id)),
    ),
  ];
  return { total, linkedPrIds };
};

// Status GR otomatis dari received_qty tiap item:
//  DRAFT    = belum ada received_qty,
//  RECEIVED = semua item received_qty >= quantity,
//  PARTIAL  = sebagian diterima.
const deriveGoodReceiptStatus = (items) => {
  const list = items || [];
  if (list.length === 0) return "DRAFT";
  const anyReceived = list.some((it) => (Number(it.received_qty) || 0) > 0);
  if (!anyReceived) return "DRAFT";
  const allFull = list.every(
    (it) =>
      (Number(it.quantity) || 0) > 0 &&
      (Number(it.received_qty) || 0) >= (Number(it.quantity) || 0),
  );
  return allFull ? "RECEIVED" : "PARTIAL";
};

// ============================================================
// GOOD RECEIPT — sinkron item dengan model "shared doc" (mirip PO):
//  - Baris dari PO (punya source_item_ids) TIDAK bikin doc baru; doc PO yang
//    ada di-set good_receipt_id + received_qty + warehouse (reuse). Field
//    quantity/price/subtotal PO TIDAK diubah (subtotal GR dihitung terpisah).
//  - Baris manual (tanpa source_item_ids) = doc baru milik GR.
//  - Doc GR yang tak lagi dirujuk -> di-detach (good_receipt_id=null,
//    received_qty=0) bila masih milik PO/PR; kalau GR-only, dihapus.
// warehouse_mode SINGLE -> semua warehouse = headerWarehouse; MULTIPLE -> per item.
// Mengembalikan { total, status } (total = Σ received_qty*price).
// ============================================================
const syncGoodReceiptItems = async ({
  grId,
  payloadItems,
  mode,
  headerWarehouse,
  session,
}) => {
  const s = session ?? null;
  const wMode = String(mode || "SINGLE").toUpperCase();
  const list = (Array.isArray(payloadItems) ? payloadItems : []).map((it) => ({
    ...it,
    received_qty: Math.max(round2(it.received_qty), 0),
    warehouse_id:
      wMode === "SINGLE" ? headerWarehouse || null : it.warehouse_id || null,
  }));

  if (wMode === "SINGLE" && !headerWarehouse) {
    throw new BadRequest("Warehouse is required for single-warehouse mode.");
  }

  for (const it of list) {
    if (it.received_qty > 0 && !it.warehouse_id) {
      throw new BadRequest(
        "Every received item must have a warehouse assigned.",
      );
    }
  }

  const reuseLines = list.filter(
    (it) => Array.isArray(it.source_item_ids) && it.source_item_ids.length > 0,
  );
  const manualLines = list.filter(
    (it) => !Array.isArray(it.source_item_ids) || it.source_item_ids.length < 1,
  );
  const reuseIds = [
    ...new Set(reuseLines.flatMap((l) => l.source_item_ids.map(String))),
  ];

  // Detach / hapus doc GR yang tak lagi dirujuk.
  const existing = await DetailProductItemModel.find({
    good_receipt_id: grId,
  }).session(s);
  for (const d of existing) {
    if (reuseIds.includes(String(d._id))) continue;
    if (!d.purchase_order_id && !d.purchase_request_id) {
      await DetailProductItemModel.deleteOne({ _id: d._id }).session(s);
    } else {
      await DetailProductItemModel.updateOne(
        { _id: d._id },
        { $set: { good_receipt_id: null, received_qty: 0 } },
      ).session(s);
    }
  }

  // Reuse doc PO: set good_receipt_id + received_qty + warehouse (per baris,
  // per source id). quantity/price/subtotal PO dibiarkan.
  for (const l of reuseLines) {
    for (const id of l.source_item_ids.map(String)) {
      await DetailProductItemModel.updateOne(
        { _id: id },
        {
          $set: {
            good_receipt_id: grId,
            received_qty: l.received_qty,
            warehouse_id: l.warehouse_id,
          },
        },
      ).session(s);
    }
  }

  // Baris manual -> doc baru milik GR.
  if (manualLines.length) {
    const { items: built } = await buildDetailProductItems(manualLines, s);
    const docs = built.map((it, i) => ({
      ...it,
      good_receipt_id: grId,
      received_qty: manualLines[i].received_qty,
      warehouse_id: manualLines[i].warehouse_id,
      subtotal: round2(
        (Number(manualLines[i].received_qty) || 0) * (Number(it.price) || 0),
      ),
    }));
    await DetailProductItemModel.insertMany(docs, {
      session: s,
      ordered: true,
    });
  }

  // Total (Σ received_qty*price) & status dari doc GR terkini.
  const linked = await DetailProductItemModel.find({
    good_receipt_id: grId,
    is_delete: { $ne: true },
  }).session(s);
  const total = round2(
    linked.reduce(
      (a, d) => a + (Number(d.received_qty) || 0) * (Number(d.price) || 0),
      0,
    ),
  );
  const status = deriveGoodReceiptStatus(linked);
  return { total, status };
};

// ============================================================
// STOCK — rekonsiliasi idempoten dari received_qty sebuah GR:
//  1. Balikkan (reverse) efek movement GR ini yang lama pada stock position,
//     lalu hapus movement-nya,
//  2. Buat movement IN baru per item (received_qty > 0 & punya warehouse),
//     dan tambahkan qty ke stock position (upsert).
// ============================================================
const reconcileGoodReceiptStock = async ({ grId, session }) => {
  const oldMoves = await StockMovementModel.find({
    good_receipt_id: grId,
  }).session(session);
  for (const mv of oldMoves) {
    await StockPositionModel.updateOne(
      { product_id: mv.product_id, warehouse_id: mv.warehouse_id },
      { $inc: { quantity: -(Number(mv.quantity) || 0) } },
      { session },
    );
  }
  if (oldMoves.length) {
    await StockMovementModel.deleteMany({ good_receipt_id: grId }).session(
      session,
    );
  }

  const [items, gr] = await Promise.all([
    DetailProductItemModel.find({
      good_receipt_id: grId,
      is_delete: { $ne: true },
    }).session(session),
    GoodReceiptModel.findById(grId).session(session),
  ]);

  const moves = [];
  // Akumulasi qty dipesan (quantity) vs diterima (qty_received) per PO & per PR.
  // Kunci map = string id (ObjectId sebagai kunci objek tidak akan cocok antar
  // dokumen), agar total lintas item benar → menentukan status akhir.
  const dataPO = new Map();
  const dataPR = new Map();

  const accumulate = (map, id, ordered, received) => {
    if (!id) return;
    const key = String(id);
    const data = map.get(key) || { quantity: 0, qty_received: 0 };
    data.quantity += ordered;
    data.qty_received += received;
    map.set(key, data);
  };

  for (const it of items) {
    const ordered = Number(it.quantity) || 0;
    const received = Number(it.received_qty) || 0;

    accumulate(dataPO, it.purchase_order_id, ordered, received);
    accumulate(dataPR, it.purchase_request_id, ordered, received);

    if (received <= 0 || !it.warehouse_id) continue;

    moves.push({
      product_id: it.product_id,
      warehouse_id: it.warehouse_id,
      uom_id: it.uom_id || null,
      good_receipt_id: grId,
      type: "IN",
      quantity: received,
      reference: gr ? gr.receipt_no : "",
      date: gr ? gr.date : new Date(),
      note: "Good receipt",
      status: "APPROVED",
    });
    await StockPositionModel.updateOne(
      { product_id: it.product_id, warehouse_id: it.warehouse_id },
      {
        $inc: { quantity: received },
        $setOnInsert: { uom_id: it.uom_id || null },
      },
      { upsert: true, session },
    );
  }
  if (moves.length) {
    await StockMovementModel.insertMany(moves, { session, ordered: true });
  }

  // Status akhir PO/PR: penuh → RECEIVED, sebagian → PARTIAL_RECEIVED.
  // Bila belum ada yang diterima (0), status tidak diubah (null → skip).
  const statusOf = ({ quantity, qty_received }) => {
    if (qty_received <= 0) return null;
    return qty_received >= quantity ? "CLOSED" : "PARTIAL_RECEIVED";
  };

  for (const [key, value] of dataPO.entries()) {
    const status = statusOf(value);
    if (!status) continue;
    await PurchaseOrderModel.findOneAndUpdate(
      { _id: key },
      { status },
      { session },
    );
  }
  for (const [key, value] of dataPR.entries()) {
    const status = statusOf(value);
    if (!status) continue;
    await PurchaseRequestModel.findOneAndUpdate(
      { _id: key },
      { status },
      { session },
    );
  }
};

// Opsi populate item standar (product/uom/supplier/warehouse ringkas).

module.exports = {
  round2,
  buildDetailProductItems,
  syncDetailProductItems,
  syncPurchaseOrderItems,
  syncGoodReceiptItems,
  deriveGoodReceiptStatus,
  reconcileGoodReceiptStock,
};
