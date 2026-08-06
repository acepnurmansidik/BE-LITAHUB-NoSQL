const mongoose = require("mongoose");
const globalService = require("../../helper/global-func");

const ProductSchema = new mongoose.Schema(
  {
    product_category_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductCategory",
      required: [true, "Product category reference is required"],
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
    code: {
      type: String,
      required: [true, "Product code is required"],
      unique: true,
      trim: true,
      uppercase: true,
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
    description: {
      type: String,
      trim: true,
      default: "",
    },
    barcode: {
      type: String,
      trim: true,
      default: "",
    },
    purchase_price: {
      type: Number,
      default: 0,
    },
    selling_price: {
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
    collection: "products",
  },
);

// Auto generate slug dari nama produk sebelum validasi
ProductSchema.pre("validate", function (next) {
  if (this.name && !this.slug) {
    this.slug = globalService.createSlug(this.name);
  }
});

module.exports =
  mongoose.models.Product || mongoose.model("Product", ProductSchema);
