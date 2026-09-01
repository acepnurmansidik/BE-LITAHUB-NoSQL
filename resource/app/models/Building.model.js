const mongoose = require("mongoose");
const globalService = require("../../helper/global-func");

const BuildingSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, "Building code is required"],
      unique: true,
      trim: true,
      uppercase: true, // Example: BLD-JKT-A
    },
    name: {
      type: String,
      required: [true, "Building name is required"],
      trim: true,
      uppercase: true, // Example: BLD-JKT-A
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    building_type: {
      type: String,
      enum: ["office", "warehouse", "factory", "retail", "mixed_use", "others"],
      default: "office",
    },
    total_floors: {
      type: Number,
      required: [true, "Total floors count is required"],
      min: [1, "Building must have at least 1 floor"],
      default: 1,
    },
    building_area_sqm: {
      type: Number, // Luas bangunan dalam meter persegi (m²)
      default: 0,
    },
    land_area_sqm: {
      type: Number, // Luas tanah dalam meter persegi (m²)
      default: 0,
    },
    // ownership_status: {
    //   type: String,
    //   enum: ["owned", "leased", "rented"],
    //   default: "owned",
    // },
    address: {
      street: { type: String, trim: true, default: "" },
      city: { type: String, trim: true, default: "" },
      state_province: { type: String, trim: true, default: "" },
      postal_code: { type: String, trim: true, default: "" },
      country: { type: String, trim: true, default: "Indonesia" },
    },
    // facilities: [
    //   {
    //     type: String,
    //     trim: true, // Example: ["elevator", "parking_lot", "generator", "security_24h"]
    //   },
    // ],
    // Foto bangunan — mengacu ke koleksi Image (model Image).
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
    collection: "buildings",
  },
);

// Auto generate slug dari nama bangunan sebelum validasi
BuildingSchema.pre("validate", function (next) {
  if (this.name && !this.slug) {
    this.slug = globalService.createSlug(this.name);
  }
});

module.exports =
  mongoose.models.Building || mongoose.model("Building", BuildingSchema);
