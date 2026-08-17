const mongoose = require("mongoose");
const globalService = require("../../helper/global-func");

const SupplierPricingSchema = new mongoose.Schema(
  {
    supplier_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: [false, "Supplier reference is required"],
    },
    uom_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Uom",
      required: [true, "Uom reference is required"],
    },
    product_image_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Image",
      default: null,
    },
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
      uppercase: true,
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    barcode: {
      type: String,
      trim: true,
      default: "",
    },
    price: {
      type: Number,
      default: 0,
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
    collection: "supplier_pricing",
  },
);

// Auto generate slug dari nama produk sebelum validasi
SupplierPricingSchema.pre("validate", function (next) {
  if (this.name && !this.slug) {
    this.slug = globalService.createSlug(this.name);
  }
});

module.exports =
  mongoose.models.SupplierPricing ||
  mongoose.model("SupplierPricing", SupplierPricingSchema);
