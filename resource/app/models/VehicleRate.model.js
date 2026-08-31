const mongoose = require("mongoose");
const globalService = require("../../helper/global-func");

const VehicleRateSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    rate: {
      type: Number,
      default: 0,
      required: true,
    },

    is_delete: { type: Boolean, default: false },
    created_by: { type: mongoose.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "vehicle_rate",
  },
);

// Pre-validate middleware untuk generate slug otomatis jika tidak diberikan secara eksplisit
VehicleRateSchema.pre("validate", function (next) {
  if (this.name && !this.slug) {
    this.slug = globalService.createSlug(this.name);
  }
});

module.exports =
  mongoose.models.VehicleRate ||
  mongoose.model("VehicleRate", VehicleRateSchema);
