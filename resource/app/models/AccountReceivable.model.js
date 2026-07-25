const mongoose = require("mongoose");
const { model, Schema } = mongoose;

// ============================================================
// ACCOUNT RECEIVABLE (Piutang Usaha) — Finance
// Satu dokumen = SATU faktur penjualan (invoice) ke pelanggan (customer).
//   - header: nomor auto (AR-YYYYMM-####), tanggal, jatuh tempo, customer, dll,
//   - baris: tiap baris menunjuk akun COA postable + nominal (amount),
//   - total_amount = jumlah semua baris; paid_amount = yang sudah dibayar,
//   - status: DRAFT | OPEN | PARTIAL | PAID (mengikuti paid_amount).
// Kode/nama akun di-snapshot ke tiap baris agar riwayat tetap benar.
// ============================================================
const ReceivableLineSchema = new Schema(
  {
    account_id: {
      type: Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      required: [true, "Line account is required!"],
    },
    account_code: { type: String, default: "", trim: true },
    account_name: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    amount: { type: Number, default: 0, min: [0, "Amount cannot be negative"] },
  },
  { _id: false },
);

const AccountReceivableSchema = new Schema(
  {
    // Nomor unik, dibuat otomatis controller (mis. "AR-202607-0001").
    entry_no: { type: String, required: true, unique: true, trim: true },
    date: { type: Date, required: [true, "Date is required!"] },
    due_date: { type: Date },
    // Nama pelanggan (customer) — teks bebas (belum ada master customer).
    party_name: { type: String, default: "", trim: true },
    reference: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: ["DRAFT", "OPEN", "PARTIAL", "PAID", "WRITE_OFF"],
      default: "DRAFT",
      uppercase: true,
    },
    lines: { type: [ReceivableLineSchema], default: [] },
    total_remaining: { type: Number, default: 0 },
    total_amount: { type: Number, default: 0 },
    paid_amount: { type: Number, default: 0 },
    is_delete: { type: Boolean, required: true, default: false },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "account_receivable",
  },
);

module.exports =
  mongoose.models.AccountReceivable ||
  model("AccountReceivable", AccountReceivableSchema);
