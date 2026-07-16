const mongoose = require("mongoose");

const AppConfigSchema = new mongoose.Schema(
  {
    // Menentukan platform: web, android, atau ios
    platform: {
      type: String,
      required: true,
      enum: ["web", "android", "ios"],
      unique: true,
    },

    // Versi terbaru yang dirilis khusus untuk platform ini (e.g., web="2.1.0", android="1.0.5")
    latest_version: {
      type: String,
      required: true,
      trim: true,
    },

    // Tipe update khusus platform ini jika app pengguna di bawah latestVersion
    update_type: {
      type: String,
      required: true,
      enum: ["NONE", "OPTIONAL", "FORCE"],
      default: "NONE",
    },

    // URL unduhan spesifik (Play Store untuk Android, App Store untuk iOS, Kosongkan/Landing untuk Web)
    download_url: {
      type: String,
      default: "",
    },

    // Status Maintenance khusus platform ini (bisa mematikan web saja, atau mobile saja)
    status_maintenance: {
      type: Boolean,
      required: true,
      default: false,
    },

    // Pesan maintenance yang bisa disesuaikan per platform
    maintenance_message: {
      type: String,
      default: "",
      // default:
      //   "Sistem sedang dalam pemeliharaan berkala. Silakan coba beberapa saat lagi.",
    },
  },
  { timestamps: true, versionKey: false, collection: "app_config" },
);

module.exports =
  mongoose.models.AppConfig || model("AppConfig", AppConfigSchema);
