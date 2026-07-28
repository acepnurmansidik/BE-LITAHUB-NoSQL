const mongoose = require("mongoose");
const globalService = require("../../helper/global-func");

const BuildingFloorSchema = new mongoose.Schema(
  {
    building_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Building",
      required: [true, "Building reference is required"],
    },
    code: {
      type: String,
      required: [true, "Floor code is required"],
      trim: true,
      uppercase: true, // Example: FLR-BLDA-01, B1 (Basement 1)
    },
    type: {
      type: String,
      enum: ["floor", "basement", "rooftop"],
      default: "floor",
    },
    name: {
      type: String,
      required: [true, "Floor name is required"],
      trim: true, // Example: "1st Floor", "Basement 1", "Rooftop"
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    floor_level: {
      type: Number,
      required: [true, "Floor level index is required"],
      default: 1, // 0 = Ground/Lobby, 1 = Floor 1, -1 = Basement 1
    },
    floor_area_sqm: {
      type: Number, // Luas lantai dalam meter persegi (m²)
      default: 0,
    },
    max_capacity: {
      type: Number, // Kapasitas maksimal orang di lantai ini
      default: 0,
    },
    floor_plan_url_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Image",
      required: [false, "Building reference is required"],
      default: null,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    is_delete: {
      type: Boolean,
      default: false,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "building_floors",
  },
);

// Auto generate slug dari nama lantai sebelum validasi
BuildingFloorSchema.pre("validate", function (next) {
  if (this.name && !this.slug) {
    this.slug = globalService.createSlug(this.name);
  }
});

module.exports =
  mongoose.models.BuildingFloor ||
  mongoose.model("BuildingFloor", BuildingFloorSchema);
