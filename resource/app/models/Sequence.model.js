const mongoose = require("mongoose");
const { model, Schema } = mongoose;

// ============================================================
// SEQUENCE — penyimpan nomor urut (running number) per MODUL + TAHUN + BULAN.
// Dipakai untuk membuat nomor dokumen unik & berurut (mis. AR-202607-0001,
// AP-202607-0003, JE-202607-0012). Increment dilakukan ATOMIK (findOneAndUpdate
// + $inc + upsert) sehingga aman dari race condition, dan urutan otomatis
// mulai lagi dari 1 tiap bulan/tahun/modul berbeda.
// ============================================================
const SequenceSchema = new Schema(
  {
    // Identitas modul: "AR" | "AP" | "JE" | dst.
    module: { type: String, required: true, uppercase: true, trim: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true }, // 1 - 12
    // Nilai urut terakhir yang sudah dipakai untuk kombinasi di atas.
    seq: { type: Number, required: true, default: 0 },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "sequence",
  },
);

// Satu baris counter per kombinasi modul+tahun+bulan.
SequenceSchema.index({ module: 1, year: 1, month: 1 }, { unique: true });

module.exports =
  mongoose.models.Sequence || model("Sequence", SequenceSchema);
