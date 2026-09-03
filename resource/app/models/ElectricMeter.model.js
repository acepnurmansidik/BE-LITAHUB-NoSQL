const mongoose = require("mongoose");

const ElectricMeterSchema = new mongoose.Schema(
  {
    unit_id: {
      type: mongoose.Types.ObjectId,
      ref: "Unit",
      required: true,
    },
    electricity_no: {
      type: String,
      unique: true,
      uppercase: true,
      required: true,
    },
    unit_name: {
      type: String,
      uppercase: true,
      required: true,
    },
    // Meter awal = current_meter dari pencatatan terakhir unit ini (0 bila belum ada).
    prev_meter: {
      type: Number,
      default: 0,
      required: true,
    },
    // Meter akhir = angka yang diinput user.
    current_meter: {
      type: Number,
      default: 0,
      required: true,
    },
    // Pemakaian = current_meter - prev_meter (dihitung ulang di server).
    usage_meter: {
      type: Number,
      default: 0,
      required: true,
    },
    // Diset hanya di backend dari usage_meter (tidak wajib dari client).
    actual_meter: {
      type: Number,
      default: 0,
    },
    // Tanggal pembacaan meter. Disimpan sebagai Date (bukan default 0 yang
    // menghasilkan epoch 1970). Bulan dari tanggal ini dipakai untuk mencegah
    // duplikasi data per unit dalam satu bulan (lihat controller).
    date: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["OPEN", "CLOSED"],
      default: "OPEN",
      uppercase: true,
    },
    // Foto meter — hanya menyimpan id ke koleksi Image (satu file).
    image_id: {
      type: mongoose.Types.ObjectId,
      ref: "Image",
      default: null,
    },

    is_delete: { type: Boolean, default: false },
    created_by: { type: mongoose.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "electric_meter",
  },
);

// Bantu query cek duplikat per unit dalam rentang bulan (unit_id + date).
ElectricMeterSchema.index({ unit_id: 1, date: 1 });

module.exports =
  mongoose.models.ElectricMeter ||
  mongoose.model("ElectricMeter", ElectricMeterSchema);
