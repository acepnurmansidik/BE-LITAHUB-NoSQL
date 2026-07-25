const mongoose = require("mongoose");
const { model, Schema } = mongoose;

// ============================================================
// JOURNAL WRITE OFF (Jurnal Penghapusan) — Finance
// Register jurnal khusus penghapusan (write-off), mis. piutang tak tertagih
// (bad debt), utang yang dihapus, atau penghapusan aset/persediaan.
// Tetap berbentuk double-entry SEIMBANG (total debit == total credit), sama
// seperti Journal Entry, tapi dengan `write_off_type` sebagai kategori.
// Kode/nama akun di-snapshot ke tiap baris.
// ============================================================
const WriteOffLineSchema = new Schema(
  {
    account_id: {
      type: Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      required: [true, "Line account is required!"],
    },
    account_code: { type: String, default: "", trim: true },
    account_name: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    // Tiap baris hanya salah satu yang terisi: debit ATAU credit (> 0).
    debit: { type: Number, default: 0, min: [0, "Debit cannot be negative"] },
    credit: { type: Number, default: 0, min: [0, "Credit cannot be negative"] },
  },
  { _id: false },
);

const JournalWriteOffSchema = new Schema(
  {
    // Nomor unik, dibuat otomatis controller (mis. "WO-202607-0001").
    entry_no: { type: String, required: true, unique: true, trim: true },
    date: { type: Date, required: [true, "Date is required!"] },
    // Jenis penghapusan (kategori).
    write_off_type: {
      type: String,
      enum: ["RECEIVABLE", "PAYABLE", "INVENTORY", "OTHER"],
      default: "OTHER",
      uppercase: true,
    },
    // Referensi sumber — mis. nomor AR/AP yang dihapus (teks bebas).
    reference: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    // Tautan ke dokumen sumber yang dihapus (Journal Entry / AR / AP).
    source_type: {
      type: String,
      enum: ["NONE", "JOURNAL_ENTRY", "ACCOUNT_RECEIVABLE", "ACCOUNT_PAYABLE"],
      default: "NONE",
      uppercase: true,
    },
    source_id: { type: Schema.Types.ObjectId }, // ref dinamis sesuai source_type
    source_no: { type: String, default: "", trim: true }, // snapshot nomor sumber
    status: {
      type: String,
      enum: ["DRAFT", "POSTED"],
      default: "DRAFT",
      uppercase: true,
    },
    lines: { type: [WriteOffLineSchema], default: [] },
    total_debit: { type: Number, default: 0 },
    total_credit: { type: Number, default: 0 },
    is_delete: { type: Boolean, required: true, default: false },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "journal_write_off",
  },
);

module.exports =
  mongoose.models.JournalWriteOff ||
  model("JournalWriteOff", JournalWriteOffSchema);
