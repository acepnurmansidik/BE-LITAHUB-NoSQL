const mongoose = require("mongoose");
const { model, Schema } = mongoose;

// ============================================================
// PURCHASE REQUEST (PR) — permintaan pembelian.
// Header saja; detail item disimpan di koleksi terpisah `purchase_items`
// (foreignField: purchase_request_id) dan diakses via virtual `items`.
//  - request_no : nomor auto (PR-YYYYMM-#####),
//  - status     : DRAFT (default) -> SUBMITTED -> (PARTIAL_)ORDERED ->
//                 PARTIAL_RECEIVED -> CLOSED (dihitung dari status item),
//  - purchase_order_id : daftar PO yang menampung item PR ini (bisa banyak,
//                 karena item bisa dipecah per-supplier menjadi beberapa PO).
// ============================================================
const PurchaseRequestSchema = new Schema(
  {
    request_no: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    date: { type: Date, required: [true, "Date is required!"] },
    needed_date: { type: Date, default: null },
    // Teks bebas (nama pemohon). Opsional.
    requested_by: { type: String, default: "", trim: true },
    reference: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: [
        "DRAFT",
        "SUBMITTED",
        "APPROVED",
        "PARTIAL_ORDERED",
        "ORDERED",
        "PARTIAL_RECEIVED",
        "RECEIVED",
        "CLOSED",
      ],
      default: "DRAFT",
      uppercase: true,
    },
    // PO yang menampung item PR ini. Bisa lebih dari satu karena item bisa
    // dipecah per-supplier menjadi beberapa PO. Dihitung otomatis dari item.
    purchase_order_id: {
      type: [{ type: Schema.Types.ObjectId, ref: "PurchaseOrder" }],
      default: [],
    },
    total_amount: { type: Number, default: 0 },

    is_delete: { type: Boolean, default: false },
    created_by: { type: mongoose.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "purchase_request",
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Detail item (koleksi purchase_items) — di-populate lewat virtual `items`.
PurchaseRequestSchema.virtual("items", {
  ref: "DetailProductItem",
  localField: "_id",
  foreignField: "purchase_request_id",
  justOne: false,
});

module.exports =
  mongoose.models.PurchaseRequest ||
  model("PurchaseRequest", PurchaseRequestSchema);
