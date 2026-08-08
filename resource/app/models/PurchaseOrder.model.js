const mongoose = require("mongoose");
const { model, Schema } = mongoose;

// ============================================================
// PURCHASE ORDER (PO) — pemesanan barang ke supplier.
// Bisa dibuat dari satu/banyak Purchase Request (pr_ids) yang otomatis
// mengisi item, atau dibuat manual tanpa PR. Detail item ada di koleksi
// `purchase_items` (foreignField: purchase_order_id) via virtual `items`.
//  - order_no : nomor auto (PO-YYYYMM-#####),
//  - status   : DRAFT (default) -> SUBMITTED (via tombol submit di list),
//  - pr_ids   : daftar PR sumber (opsional).
// ============================================================
const PurchaseOrderSchema = new Schema(
  {
    order_no: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    date: { type: Date, required: [true, "Date is required!"] },
    expected_date: { type: Date, default: null },
    reference: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: [
        "DRAFT",
        "SUBMITTED",
        "APPROVED",
        "PARTIAL_RECEIVED",
        "RECEIVED",
        "CLOSED",
      ],
      default: "DRAFT",
      uppercase: true,
    },
    // PR sumber (opsional). Kosong bila PO dibuat manual.
    pr_ids: {
      type: [{ type: Schema.Types.ObjectId, ref: "PurchaseRequest" }],
      default: [],
    },
    // Supplier PO (opsional). Diisi otomatis saat PO dibuat dengan mengelompokkan
    // item per-supplier (satu PO = satu supplier). Null bila item tanpa supplier.
    supplier_id: {
      type: Schema.Types.ObjectId,
      ref: "Supplier",
      default: null,
    },
    total_amount: { type: Number, default: 0 },

    is_delete: { type: Boolean, default: false },
    created_by: { type: mongoose.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "purchase_order",
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

PurchaseOrderSchema.virtual("items", {
  ref: "DetailProductItem",
  localField: "_id",
  foreignField: "purchase_order_id",
  justOne: false,
});

module.exports =
  mongoose.models.PurchaseOrder || model("PurchaseOrder", PurchaseOrderSchema);
