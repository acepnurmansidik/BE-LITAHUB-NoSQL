const mongoose = require("mongoose");
const globalService = require("../../helper/global-func");
const { generateShortCode } = require("../../helper/codeGenerator");

const BranchSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, "Branch code is required"],
      unique: true,
      trim: true,
      uppercase: true, // Example: BRN-JKT-01
    },
    name: {
      type: String,
      required: [true, "Branch name is required"],
      trim: true,
      uppercase: true, // Example: BRN-JKT-01
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    contact_info: {
      phone: {
        type: [String],
        default: [],
      },
      email: {
        type: String,
        lowercase: true,
        trim: true,
        default: "",
      },
      manager_name: {
        type: String,
        trim: true,
        default: "",
      },
    },
    address: {
      street: { type: String, trim: true, default: "" },
      city: { type: String, trim: true, default: "" },
      state_province: { type: String, trim: true, default: "" },
      postal_code: { type: String, trim: true, default: "" },
      country: { type: String, trim: true, default: "Indonesia" },
    },
    // GeoJSON Point untuk pencarian lokasi terdekat (Geospatial query)
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // Format: [longitude, latitude]
        default: [0, 0],
      },
    },
    // operating_hours: {
    //   opening_time: { type: String, default: "08:00" }, // Format HH:mm
    //   closing_time: { type: String, default: "17:00" },
    //   is_open_weekend: { type: Boolean, default: false },
    // },
    // is_main_branch: {
    //   type: Boolean,
    //   default: false, // Menandai apakah ini cabang utama / pusat
    // },
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
    collection: "branches",
  },
);

// Indexing untuk Geospatial Query (mencari cabang terdekat berdasarkan koordinat)
BranchSchema.index(
  { slug: 1, code: 1, location: "2dsphere" },
  { unique: true },
);

// Pre-validate middleware untuk generate slug otomatis jika tidak diberikan secara eksplisit
BranchSchema.pre("validate", function (next) {
  if (this.name && !this.slug) {
    this.slug = globalService.createSlug(this.name);
    this.code = generateShortCode(this.name);
  }
});

module.exports =
  mongoose.models.Branch || mongoose.model("Branch", BranchSchema);
