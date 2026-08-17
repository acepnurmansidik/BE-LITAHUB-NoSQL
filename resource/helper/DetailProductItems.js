const ProductModel = require("../app/models/Product.model");
const DetailProductItemModel = require("../app/models/DetailProductItem.model");
const StockMovementModel = require("../app/models/StockMovement.model");
const StockPositionModel = require("../app/models/StockPosition.model");
const GoodReceiptModel = require("../app/models/GoodReceipt.model");
const DeliveryOrderModel = require("../app/models/DeliveryOrder.model");
const BadRequest = require("../utils/errors/bad-request");
const PurchaseOrderModel = require("../app/models/PurchaseOrder.model");
const PurchaseRequestModel = require("../app/models/PurchaseRequest.model");

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Tentukan harga asal & harga baru sebuah baris item.
//  - price     : harga asal (mengikuti master saat item dibuat),
//  - new_price : harga hasil edit user; bila tidak dikirim = price.
// Bila new_price != price berarti user meng-update harga.
const resolveItemPrice = (raw, index = 0) => {
  const price = round2(raw.price);
  if (price < 0) {
    throw new BadRequest(`Item ${index + 1}: price cannot be negative.`);
  }
  const hasNew =
    raw.new_price !== undefined &&
    raw.new_price !== null &&
    raw.new_price !== "";
  const new_price = hasNew ? round2(raw.new_price) : price;
  if (new_price < 0) {
    throw new BadRequest(`Item ${index + 1}: new price cannot be negative.`);
  }
  return { price, new_price };
};

// Terapkan perubahan harga master product (purchase_price) dari sebuah Map
// productId -> newPrice.
const applyProductPriceUpdates = async (updates, session) => {
  if (!updates || updates.size === 0) return;
  for (const [productId, newPrice] of updates.entries()) {
    await ProductModel.updateOne(
      { _id: productId },
      { $set: { purchase_price: newPrice } },
    ).session(session ?? null);
  }
};

// Propagasi harga baru ke master product berdasarkan _id sebuah detail item
// (dipakai saat edit harga baris reuse PR di PO).
const propagatePriceByDetailId = async (detailId, newPrice, session) => {
  const doc = await DetailProductItemModel.findById(detailId)
    .select("product_id")
    .session(session ?? null);
  if (doc && doc.product_id) {
    await ProductModel.updateOne(
      { _id: doc.product_id },
      { $set: { purchase_price: newPrice } },
    ).session(session ?? null);
  }
};

// Valid parent fields — tiap baris item hanya menempel ke satu parent.
const PARENT_FIELDS = [
  "purchase_request_id",
  "purchase_order_id",
  "good_receipt_id",
  "delivery_order_id",
];

// ============================================================
// STATUS ITEM & DOKUMEN INDUK
// Status item (detail_product_items.status):
//   PENDING -> ORDERED -> PARTIAL_RECEIVED -> RECEIVED
// Dihitung dari received_qty & keterikatan PO; jadi sumber kebenaran untuk
// men-derive status PR & PO.
// ============================================================

// Status sebuah item dari qty diterima & apakah sudah masuk PO.
const itemStatusFrom = (item) => {
  const q = Number(item.quantity) || 0;
  const r = Number(item.received_qty) || 0;
  if (r > 0 && r >= q) return "RECEIVED";
  if (r > 0) return "PARTIAL_RECEIVED";
  if (item.purchase_order_id) return "ORDERED";
  return "PENDING";
};

// Status PR dari kumpulan item-nya.
//  semua RECEIVED                 -> CLOSED
//  ada RECEIVED/PARTIAL_RECEIVED  -> PARTIAL_RECEIVED
//  semua PENDING                  -> SUBMITTED (kembali ke awal, siap dipesan)
//  semua ORDERED                  -> ORDERED
//  campuran PENDING & ORDERED     -> PARTIAL_ORDERED
const derivePurchaseRequestStatus = (items) => {
  if (!items.length) return null;
  const st = items.map((i) => i.status);
  if (st.every((s) => s === "RECEIVED")) return "CLOSED";
  if (st.some((s) => s === "RECEIVED" || s === "PARTIAL_RECEIVED"))
    return "PARTIAL_RECEIVED";
  if (st.every((s) => s === "PENDING")) return "SUBMITTED";
  if (st.every((s) => s === "ORDERED")) return "ORDERED";
  return "PARTIAL_ORDERED";
};

// Status PO dari kumpulan item-nya.
//  semua RECEIVED                 -> CLOSED
//  ada RECEIVED/PARTIAL_RECEIVED  -> PARTIAL_RECEIVED
//  selain itu (semua ORDERED)     -> SUBMITTED (sudah dipesan, belum diterima)
const derivePurchaseOrderStatus = (items) => {
  if (!items.length) return null;
  const st = items.map((i) => i.status);
  if (st.every((s) => s === "RECEIVED")) return "CLOSED";
  if (st.some((s) => s === "RECEIVED" || s === "PARTIAL_RECEIVED"))
    return "PARTIAL_RECEIVED";
  return "SUBMITTED";
};

// Recompute status PO & PR (dan array purchase_order_id PR) dari item terkini.
// Dipanggil setelah operasi PO (create/update/delete) & GR (receive/delete).
const syncParentStatuses = async ({ poIds = [], prIds = [], session }) => {
  const s = session ?? null;
  const uniq = (arr) => [...new Set(arr.filter(Boolean).map(String))];

  for (const poId of uniq(poIds)) {
    const [items, po] = await Promise.all([
      DetailProductItemModel.find({
        purchase_order_id: poId,
        is_delete: { $ne: true },
      }).session(s),
      PurchaseOrderModel.findById(poId).select("status").session(s),
    ]);
    const status = derivePurchaseOrderStatus(items);
    // Jangan auto-promote PO yang masih DRAFT (harus disubmit manual dulu).
    if (status && po && po.status !== "DRAFT") {
      await PurchaseOrderModel.updateOne({ _id: poId }, { status }).session(s);
    }
  }

  for (const prId of uniq(prIds)) {
    const [items, pr] = await Promise.all([
      DetailProductItemModel.find({
        purchase_request_id: prId,
        is_delete: { $ne: true },
      }).session(s),
      PurchaseRequestModel.findById(prId).select("status").session(s),
    ]);
    const poLinks = uniq(
      items.filter((i) => i.purchase_order_id).map((i) => i.purchase_order_id),
    );
    const update = { purchase_order_id: poLinks };
    const status = derivePurchaseRequestStatus(items);
    // Jangan turunkan PR yang masih DRAFT (belum disubmit).
    if (status && pr && pr.status !== "DRAFT") update.status = status;
    await PurchaseRequestModel.updateOne({ _id: prId }, update).session(s);
  }
};

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
  // Perubahan harga master (product.purchase_price) yang perlu di-apply karena
  // user meng-edit harga item (new_price != price).
  const priceUpdates = new Map(); // productId -> newPrice (last wins)

  const items = rawItems.map((raw, index) => {
    const prod = raw.product_id ? byId.get(String(raw.product_id)) : null;
    if (!prod) throw new BadRequest(`Item ${index + 1}: product not found.`);

    const quantity = round2(raw.quantity);
    if (quantity <= 0) {
      throw new BadRequest(
        `Item ${index + 1}: quantity must be greater than 0.`,
      );
    }
    // `price`     = harga asal (mengikuti master product saat item dibuat),
    // `new_price` = harga yang di-edit user. Bila berbeda -> harga master
    // product ikut diperbarui, dan harga item yang DISIMPAN adalah new_price.
    const { price, new_price } = resolveItemPrice(raw, index);
    if (new_price !== price) {
      priceUpdates.set(String(prod._id), new_price);
    }
    const storedPrice = new_price; // saat sama, new_price === price
    const received_qty = Math.max(round2(raw.received_qty), 0);
    const subtotal = round2(quantity * storedPrice);
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
      price: storedPrice,
      new_price,
      subtotal,
    };
  });

  // Propagasi harga baru ke master product (purchase_price).
  await applyProductPriceUpdates(priceUpdates, session);

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

  // Doc dari PR yang dilepas dari PO -> dikembalikan ke PR (status PENDING),
  // BUKAN dihapus, agar item-nya masih bisa dibuatkan PO lagi.
  const removedPrDocs = existing.filter(
    (d) => d.purchase_request_id && !reuseIds.includes(String(d._id)),
  );
  const removedPrIds = [
    ...new Set(removedPrDocs.map((d) => String(d.purchase_request_id))),
  ];
  if (removedPrDocs.length) {
    await DetailProductItemModel.updateMany(
      { _id: { $in: removedPrDocs.map((d) => d._id) } },
      {
        $set: { purchase_order_id: null, status: "PENDING", supplier_id: null },
      },
    ).session(s);
  }

  // Link/reuse doc PR ke PO + tandai ORDERED.
  for (const id of reuseIds) {
    const edit = singleEdits.get(id);
    const set = { purchase_order_id: poId, status: "ORDERED" };
    if (edit) {
      const q = round2(edit.quantity);
      const { price, new_price } = resolveItemPrice(edit);
      set.quantity = q;
      set.price = new_price; // harga tersimpan = new_price bila di-edit
      set.new_price = new_price;
      set.subtotal = round2(q * new_price);
      if (edit.uom_id) set.uom_id = edit.uom_id;
      set.supplier_id = edit.supplier_id || null;
      // Harga di-edit -> perbarui master product (purchase_price).
      if (new_price !== price) await propagatePriceByDetailId(id, new_price, s);
    }
    await DetailProductItemModel.updateOne({ _id: id }, { $set: set }).session(
      s,
    );
  }

  // Buat baris manual baru milik PO (langsung ORDERED).
  if (manualItems.length) {
    await DetailProductItemModel.insertMany(
      manualItems.map((it) => ({
        ...it,
        purchase_order_id: poId,
        status: "ORDERED",
      })),
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
  const affectedPrIds = [...new Set([...linkedPrIds, ...removedPrIds])];
  return { total, linkedPrIds, affectedPrIds };
};

// ============================================================
// PURCHASE ORDER (CREATE, split per-supplier) — tautkan sekumpulan item ke
// SATU PO yang baru dibuat:
//  - baris reuse (source_item_ids = _id detail PR) -> doc PR di-set
//    purchase_order_id + supplier + status ORDERED (reuse shared doc),
//  - baris manual -> doc baru milik PO (status ORDERED).
// Mengembalikan { total, prIds } (prIds = PR sumber yang tersentuh).
// ============================================================
const linkItemsToPurchaseOrder = async ({
  poId,
  supplierId,
  items,
  session,
}) => {
  const s = session ?? null;
  const list = Array.isArray(items) ? items : [];
  const reuseLines = list.filter(
    (it) => Array.isArray(it.source_item_ids) && it.source_item_ids.length > 0,
  );
  const manualRaw = list.filter(
    (it) => !Array.isArray(it.source_item_ids) || it.source_item_ids.length < 1,
  );

  for (const l of reuseLines) {
    const single = l.source_item_ids.length === 1;
    for (const id of l.source_item_ids.map(String)) {
      const set = {
        purchase_order_id: poId,
        supplier_id: supplierId || l.supplier_id || null,
        status: "ORDERED",
      };
      if (single) {
        const q = round2(l.quantity);
        const { price, new_price } = resolveItemPrice(l);
        if (q > 0) {
          set.quantity = q;
          set.subtotal = round2(q * new_price);
        }
        set.price = new_price; // harga tersimpan = new_price bila di-edit
        set.new_price = new_price;
        if (l.uom_id) set.uom_id = l.uom_id;
        // Harga di-edit -> perbarui master product (purchase_price).
        if (new_price !== price) await propagatePriceByDetailId(id, new_price, s);
      }
      await DetailProductItemModel.updateOne(
        { _id: id },
        { $set: set },
      ).session(s);
    }
  }

  if (manualRaw.length) {
    const { items: built } = await buildDetailProductItems(manualRaw, s);
    await DetailProductItemModel.insertMany(
      built.map((it) => ({
        ...it,
        supplier_id: supplierId || it.supplier_id || null,
        purchase_order_id: poId,
        status: "ORDERED",
      })),
      { session: s, ordered: true },
    );
  }

  const linked = await DetailProductItemModel.find({
    purchase_order_id: poId,
    is_delete: { $ne: true },
  }).session(s);
  const total = round2(
    linked.reduce((a, d) => a + (Number(d.subtotal) || 0), 0),
  );
  const prIds = [
    ...new Set(
      linked
        .filter((d) => d.purchase_request_id)
        .map((d) => String(d.purchase_request_id)),
    ),
  ];
  return { total, prIds };
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
      // Lepas dari GR & kembalikan status: ORDERED bila masih milik PO, kalau
      // tidak PENDING (kembali ke PR saja).
      await DetailProductItemModel.updateOne(
        { _id: d._id },
        {
          $set: {
            good_receipt_id: null,
            received_qty: 0,
            status: d.purchase_order_id ? "ORDERED" : "PENDING",
          },
        },
      ).session(s);
    }
  }

  // Reuse doc PO: set good_receipt_id + received_qty + warehouse (per baris,
  // per source id). quantity/price/subtotal PO dibiarkan.
  for (const l of reuseLines) {
    const q = Number(l.quantity) || 0;
    const r = Number(l.received_qty) || 0;
    // Status item dari qty diterima; 0 = kembali ORDERED (masih dipesan).
    const status = r > 0 ? (r >= q ? "RECEIVED" : "PARTIAL_RECEIVED") : "ORDERED";
    for (const id of l.source_item_ids.map(String)) {
      await DetailProductItemModel.updateOne(
        { _id: id },
        {
          $set: {
            good_receipt_id: grId,
            received_qty: l.received_qty,
            warehouse_id: l.warehouse_id,
            status,
          },
        },
      ).session(s);
    }
  }

  // Baris manual -> doc baru milik GR.
  if (manualLines.length) {
    const { items: built } = await buildDetailProductItems(manualLines, s);
    const docs = built.map((it, i) => {
      const q = Number(it.quantity) || 0;
      const r = Number(manualLines[i].received_qty) || 0;
      return {
        ...it,
        good_receipt_id: grId,
        received_qty: r,
        warehouse_id: manualLines[i].warehouse_id,
        subtotal: round2(r * (Number(it.price) || 0)),
        status: r > 0 ? (r >= q ? "RECEIVED" : "PARTIAL_RECEIVED") : "PENDING",
      };
    });
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

  // PO & PR yang tersentuh (dari doc reuse + doc yang dilepas) untuk recompute
  // status induk setelah GR berubah.
  const affectedDocs = await DetailProductItemModel.find({
    _id: {
      $in: [...new Set([...reuseIds, ...existing.map((d) => String(d._id))])],
    },
  }).session(s);
  const affectedPoIds = [
    ...new Set(
      affectedDocs
        .filter((d) => d.purchase_order_id)
        .map((d) => String(d.purchase_order_id)),
    ),
  ];
  const affectedPrIds = [
    ...new Set(
      affectedDocs
        .filter((d) => d.purchase_request_id)
        .map((d) => String(d.purchase_request_id)),
    ),
  ];

  return { total, status, affectedPoIds, affectedPrIds };
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

  for (const it of items) {
    const received = Number(it.received_qty) || 0;
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
  // Catatan: status akhir PO/PR (CLOSED / PARTIAL_RECEIVED) di-recompute lewat
  // syncParentStatuses dari status tiap item, dipanggil oleh GoodReceipt
  // controller setelah sync + reconcile.
};

// ============================================================
// STOCK (Delivery Order) — balikkan (reverse) seluruh movement OUT milik DO ini
// pada stock position lalu hapus movement-nya. Dipakai saat update (sebelum
// re-apply) & saat delete. Stok gudang bertambah kembali sebesar qty movement.
// ============================================================
const releaseDeliveryOrderStock = async ({ doId, session }) => {
  const oldMoves = await StockMovementModel.find({
    delivery_order_id: doId,
  }).session(session);
  for (const mv of oldMoves) {
    // Movement OUT dulu mengurangi stok sebesar qty → kembalikan (+qty).
    await StockPositionModel.updateOne(
      { product_id: mv.product_id, warehouse_id: mv.warehouse_id },
      { $inc: { quantity: Number(mv.quantity) || 0 } },
      { session },
    );
  }
  if (oldMoves.length) {
    await StockMovementModel.deleteMany({ delivery_order_id: doId }).session(
      session,
    );
  }
};

// ============================================================
// STOCK (Delivery Order) — rekonsiliasi idempoten pengeluaran barang sebuah DO:
//  1. Reverse movement OUT lama DO ini (via releaseDeliveryOrderStock),
//  2. Validasi stok tersedia di gudang sumber cukup untuk SEMUA item (kalau
//     kurang → throw, tidak ada pengurangan parsial),
//  3. Buat movement OUT baru per item & kurangi stock position.
// Stok berkurang sejak DO dibuat (status PENDING) — tidak menunggu dikirim.
// ============================================================
const reconcileDeliveryOrderStock = async ({ doId, session }) => {
  await releaseDeliveryOrderStock({ doId, session });

  const [items, deliveryOrder] = await Promise.all([
    DetailProductItemModel.find({
      delivery_order_id: doId,
      is_delete: { $ne: true },
    }).session(session),
    DeliveryOrderModel.findById(doId).session(session),
  ]);
  if (!deliveryOrder) throw new BadRequest("Delivery order not found.");
  const warehouseId = deliveryOrder.warehouse_id;
  if (!warehouseId) throw new BadRequest("Source warehouse is required.");

  // Validasi stok tersedia lebih dulu untuk seluruh item.
  for (const it of items) {
    const qty = Number(it.quantity) || 0;
    if (qty <= 0) continue;
    const pos = await StockPositionModel.findOne({
      product_id: it.product_id,
      warehouse_id: warehouseId,
    }).session(session);
    const available = pos ? Number(pos.quantity) || 0 : 0;
    if (available < qty) {
      throw new BadRequest(
        `Insufficient stock for ${it.product_name || "product"}: available ${available}, need ${qty}.`,
      );
    }
  }

  const moves = [];
  for (const it of items) {
    const qty = Number(it.quantity) || 0;
    if (qty <= 0) continue;
    await StockPositionModel.updateOne(
      { product_id: it.product_id, warehouse_id: warehouseId },
      { $inc: { quantity: -qty } },
      { session },
    );
    moves.push({
      product_id: it.product_id,
      warehouse_id: warehouseId,
      uom_id: it.uom_id || null,
      delivery_order_id: doId,
      type: "OUT",
      quantity: qty,
      reference: deliveryOrder.delivery_no,
      date: deliveryOrder.delivery_date || deliveryOrder.date || new Date(),
      note: "Delivery order",
      status: "APPROVED",
    });
  }
  if (moves.length) {
    await StockMovementModel.insertMany(moves, { session, ordered: true });
  }
};

// Opsi populate item standar (product/uom/supplier/warehouse ringkas).

module.exports = {
  round2,
  itemStatusFrom,
  derivePurchaseRequestStatus,
  derivePurchaseOrderStatus,
  syncParentStatuses,
  buildDetailProductItems,
  syncDetailProductItems,
  syncPurchaseOrderItems,
  linkItemsToPurchaseOrder,
  syncGoodReceiptItems,
  deriveGoodReceiptStatus,
  reconcileGoodReceiptStock,
  reconcileDeliveryOrderStock,
  releaseDeliveryOrderStock,
};
