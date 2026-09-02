const mongoose = require("mongoose");

// ============================================================
// OWNERSHIP — Kepemilikan / penghuni sebuah Unit.
// Modul Contract (MOD_CONTRACT)
// ============================================================
const OwnershipSchema = new mongoose.Schema(
  {
    // Unit yang dimiliki/dihuni. WAJIB ref ke koleksi Unit.
    unit_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit",
      required: [true, "Unit reference is required"],
    },
    // Disalin dari Unit untuk memudahkan pencarian/tampilan (opsional).
    unit_name: {
      type: String,
      trim: true,
      default: "",
    },
    // Pemilik/penghuni = referensi ke User. WAJIB.
    user_ownership_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ownership reference is required"],
    },
    // Nama pemilik/penghuni — DISET di backend dari nama User (user_ownership_id).
    owner_name: {
      type: String,
      trim: true,
      default: "",
    },
    // Jenis kepemilikan: pemilik atau penyewa.
    ownership_type: {
      type: String,
      enum: ["OWNER", "TENANT"],
      default: "OWNER",
      uppercase: true,
    },
    // Nomor identitas (KTP/Passport).
    identity_number: {
      type: String,
      trim: true,
      default: "",
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    address: {
      type: String,
      trim: true,
      default: "",
    },
    // Masa kepemilikan/sewa (opsional).
    start_date: {
      type: Date,
      default: null,
    },
    end_date: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    is_delete: {
      type: Boolean,
      default: false,
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "ownership",
  },
);

// Bantu query kepemilikan per unit.
OwnershipSchema.index({ unit_id: 1 });

module.exports =
  mongoose.models.Ownership || mongoose.model("Ownership", OwnershipSchema);
