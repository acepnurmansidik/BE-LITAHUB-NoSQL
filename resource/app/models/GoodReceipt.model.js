const mongoose = require("mongoose");
const { model, Schema } = mongoose;

// ============================================================
// GOOD RECEIPT (GR) — penerimaan barang atas satu / beberapa Purchase Order.
// Item diterima disimpan di koleksi detail_product_items
// (foreignField: good_receipt_id) via virtual `items`.
//  - receipt_no     : nomor auto (GR-YYYYMM-#####),
//  - po_ids         : daftar PO yang diterima (bisa banyak),
//  - warehouse_mode : SINGLE  -> semua item masuk `warehouse_id` header,
//                     MULTIPLE -> tiap item punya warehouse_id sendiri,
//  - status         : dihitung otomatis dari received_qty:
//                     DRAFT (belum ada diterima) / PARTIAL (sebagian) /
//                     RECEIVED (semua qty diterima).
// ============================================================
const GoodReceiptSchema = new Schema(
  {
    receipt_no: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    date: { type: Date, required: [true, "Date is required!"] },
    received_date: { type: Date, default: null },
    reference: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: ["DRAFT", "PARTIAL", "RECEIVED"],
      default: "DRAFT",
      uppercase: true,
    },
    // PO sumber (bisa lebih dari satu).
    po_ids: {
      type: [{ type: Schema.Types.ObjectId, ref: "PurchaseOrder" }],
      default: [],
    },
    // Gudang penerimaan default (dipakai saat warehouse_mode SINGLE).
    warehouse_id: {
      type: Schema.Types.ObjectId,
      ref: "Warehouse",
      default: null,
    },
    warehouse_mode: {
      type: String,
      enum: ["SINGLE", "MULTIPLE"],
      default: "SINGLE",
      uppercase: true,
    },
    total_amount: { type: Number, default: 0 },
    is_delete: { type: Boolean, required: true, default: false },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "good_receipt",
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

GoodReceiptSchema.virtual("items", {
  ref: "DetailProductItem",
  localField: "_id",
  foreignField: "good_receipt_id",
  justOne: false,
});

module.exports =
  mongoose.models.GoodReceipt || model("GoodReceipt", GoodReceiptSchema);
