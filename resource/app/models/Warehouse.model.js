const mongoose = require("mongoose");
const globalService = require("../../helper/global-func");

const WarehouseSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, "Warehouse code is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: [true, "Warehouse name is required"],
      trim: true,
      uppercase: true,
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    address: {
      street: { type: String, trim: true, default: "" },
      city: { type: String, trim: true, default: "" },
      state_province: { type: String, trim: true, default: "" },
      postal_code: { type: String, trim: true, default: "" },
      country: { type: String, trim: true, default: "Indonesia" },
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    is_delete: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "warehouses",
  },
);

// Pre-validate middleware untuk generate slug otomatis jika tidak diberikan secara eksplisit
WarehouseSchema.pre("validate", function (next) {
  if (this.name && !this.slug) {
    this.slug = globalService.createSlug(this.name);
  }
});

module.exports =
  mongoose.models.Warehouse || mongoose.model("Warehouse", WarehouseSchema);
