const mongoose = require("mongoose");
const { model, Schema } = mongoose;

const AppReleaseLogSchema = Schema(
  {
    // Platform yang merilis versi baru
    platform: {
      type: String,
      required: true,
    },

    // Versi yang dirilis pada saat itu (e.g., "1.1.0")
    version_released: {
      type: String,
      required: true,
      trim: true,
    },

    // Tipe update saat versi ini dirilis
    update_type: {
      type: String,
      required: true,
      enum: ["NONE", "OPTIONAL", "FORCE"],
      default: "NONE",
    },

    // Catatan rilis / Changelog (fitur baru, perbaikan bug, dll)
    release_notes: {
      type: String,
      default: "",
    },

    // Status Maintenance khusus platform ini (bisa mematikan web saja, atau mobile saja)
    status_maintenance: {
      type: Boolean,
      required: true,
      default: false,
    },

    // Siapa yang melakukan rilis / memicu perubahan (Opsional, jika ada sistem admin)
    released_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true, versionKey: false, collection: "app_release_logs" },
);

// Indeks untuk mempermudah pencarian riwayat per platform berdasarkan versi terbaru
AppReleaseLogSchema.index({ platform: 1, createdAt: -1 });

module.exports = model("AppReleaseLog", AppReleaseLogSchema);
