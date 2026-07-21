const mongoose = require("mongoose");
const { model, Schema } = mongoose;

// ============================================================
// JOURNAL ENTRY (Jurnal Umum) — Finance
// Satu entri jurnal = SATU header + banyak baris (double-entry). Aturan pokok:
//   - minimal 2 baris,
//   - tiap baris mereferensikan akun COA yang POSTABLE (bukan header),
//   - tiap baris hanya salah satu: debit ATAU credit (> 0),
//   - total debit HARUS sama dengan total credit (balanced).
// Kode/nama akun di-snapshot ke tiap baris agar tampilan riwayat tetap benar
// walau master COA berubah kemudian.
// ============================================================
const JournalLineSchema = new Schema(
  {
    account_id: {
      type: Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      required: [true, "Line account is required!"],
    },
    // Snapshot kode & nama akun saat entri dibuat/diperbarui.
    account_code: { type: String, default: "", trim: true },
    account_name: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    debit: { type: Number, default: 0, min: [0, "Debit cannot be negative"] },
    credit: { type: Number, default: 0, min: [0, "Credit cannot be negative"] },
  },
  { _id: false },
);

const JournalEntrySchema = new Schema(
  {
    // Nomor jurnal unik, dibuat otomatis controller (mis. "JE-202607-0001").
    entry_no: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    date: {
      type: Date,
      required: [true, "Journal date is required!"],
    },
    description: { type: String, default: "", trim: true },
    reference: { type: String, default: "", trim: true },
    // DRAFT = masih bisa diubah bebas; POSTED = sudah dibukukan.
    status: {
      type: String,
      enum: ["DRAFT", "POSTED"],
      default: "DRAFT",
      uppercase: true,
    },
    lines: {
      type: [JournalLineSchema],
      default: [],
    },

    // Ringkasan total (disimpan agar list & laporan tak perlu re-agregasi).
    total_debit: { type: Number, default: 0 },
    total_credit: { type: Number, default: 0 },

    // // Peta Dinamis: Mengubungkan Jurnal ke transaksi operasionalnya
    // source_model: {
    //   type: String,
    //   required: true,
    //   enum: ["Invoice", "Payment"],
    // },
    // source_id: {
    //   type: mongoose.Schema.Types.ObjectId,
    //   required: true,
    //   refPath: "source_model", // Mongoose akan melihat nilai sourceModel untuk menentukan model target
    // },
    is_delete: { type: Boolean, required: true, default: false },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "journal_entry",
  },
);

module.exports =
  mongoose.models.JournalEntry || model("JournalEntry", JournalEntrySchema);
