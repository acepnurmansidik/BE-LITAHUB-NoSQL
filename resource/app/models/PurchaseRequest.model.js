const mongoose = require("mongoose");
const { model, Schema } = mongoose;

// ============================================================
// PURCHASE REQUEST (PR) — permintaan pembelian.
// Header saja; detail item disimpan di koleksi terpisah `purchase_items`
// (foreignField: purchase_request_id) dan diakses via virtual `items`.
//  - request_no : nomor auto (PR-YYYYMM-#####),
//  - status     : DRAFT (default) -> SUBMITTED (via tombol submit di list),
//  - purchase_order_id : flag apakah PR sudah dibuatkan PO (opsional).
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
        "PARTIAL_RECEIVED",
        "RECEIVED",
        "CLOSED",
      ],
      default: "DRAFT",
      uppercase: true,
    },
    // Terisi bila PR sudah di-generate menjadi PO (penanda "sudah dipesan").
    purchase_order_id: {
      type: Schema.Types.ObjectId,
      ref: "PurchaseOrder",
      default: null,
    },
    total_amount: { type: Number, default: 0 },
    is_delete: { type: Boolean, required: true, default: false },
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
