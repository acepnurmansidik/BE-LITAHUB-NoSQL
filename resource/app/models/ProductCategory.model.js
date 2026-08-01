const mongoose = require("mongoose");
const globalService = require("../../helper/global-func");

// ============================================================
// LINE ACCOUNT — baris daftar akun (COA) milik sebuah Product Category.
// Di-embed sebagai array `line_accounts` di dalam ProductCategory (satu file).
// `product_category_id` otomatis null bila tidak dipilih saat mengisi baris.
// ============================================================
const LineAccountSchema = new mongoose.Schema(
  {
    product_category_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductCategory",
      default: null,
    },
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
    },
    account_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      required: [true, "Account (COA) is required"],
    },
    is_delete: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

// ============================================================
// PRODUCT CATEGORY — kategori produk (mis. "Bahan Baku", "Barang Jadi").
// `prefix` dipakai sebagai awalan kode produk. `line_accounts` = daftar COA
// (embedded) tiap baris berisi title + referensi ke ChartOfAccount.
// ============================================================
const ProductCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Category name is required"],
      trim: true,
      uppercase: true,
    },
    prefix: {
      type: String,
      required: [true, "Prefix is required"],
      trim: true,
      uppercase: true,
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    line_accounts: {
      type: [LineAccountSchema],
      default: [],
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
    collection: "product_categories",
  },
);

// Auto generate slug dari nama kategori sebelum validasi.
ProductCategorySchema.pre("validate", function (next) {
  if (this.name && !this.slug) {
    this.slug = globalService.createSlug(this.name);
  }
});

module.exports =
  mongoose.models.ProductCategory ||
  mongoose.model("ProductCategory", ProductCategorySchema);
