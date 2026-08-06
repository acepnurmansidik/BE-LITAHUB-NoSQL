const mongoose = require("mongoose");
const globalService = require("../../helper/global-func");

const SupplierSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, "Supplier code is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: [true, "Supplier name is required"],
      trim: true,
      uppercase: true,
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
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
      contact_person: {
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
    collection: "suppliers",
  },
);

// Pre-validate middleware untuk generate slug otomatis jika tidak diberikan secara eksplisit
SupplierSchema.pre("validate", function (next) {
  if (this.name && !this.slug) {
    this.slug = globalService.createSlug(this.name);
  }
});

module.exports =
  mongoose.models.Supplier || mongoose.model("Supplier", SupplierSchema);
