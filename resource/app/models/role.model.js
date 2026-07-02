const mongoose = require("mongoose");
const globalService = require("../../helper/global-func");
const { model, Schema } = mongoose;

// Sub-schema untuk children menu (sub-menu)
const RoleMenuDetailSchema = new Schema(
  {
    name: { type: String, required: true },
    path: { type: String, required: true },
    actions: { type: Map, of: Boolean, default: {} }, // Record<string, boolean>
  },
  { _id: false },
);

// Sub-schema untuk permission (menu utama)
const RolePermissionSchema = new Schema(
  {
    icon: { type: String, required: true },
    menu_name: { type: String, required: true },
    path: { type: String, required: true },
    actions: { type: Map, of: Boolean, default: {} }, // Record<string, boolean>
    children: [RoleMenuDetailSchema],
  },
  { _id: false },
);

// Sub-schema untuk modul
const RoleModuleSchema = new Schema(
  {
    name: { type: String, required: true },
    title: { type: String, required: true },
    permission: [RolePermissionSchema],
  },
  { _id: false },
);

const PathAccessSchema = new Schema(
  {
    path: { type: String, required: true },
    actions: { type: Map, of: Boolean, default: {} }, // Record<string, boolean>
  },
  { _id: false },
);

const RoleSchema = new Schema(
  {
    name: {
      type: String,
      minlength: [3, "Name must be at least 3 characters long"],
      required: [true, "Name is required!"],
    },
    slug: {
      type: String,
      minlength: [3, "Slug must be at least 3 characters long"],
      required: [true, "Slug is required!"],
      unique: true,
      trim: true,
      lowercase: true,
    },
    // Menyesuaikan dengan interface: has_access_module
    has_access_module: [RoleModuleSchema],
    path_access: [PathAccessSchema],

    is_delete: { type: Boolean, required: true, default: false },
    created_by: { type: mongoose.Types.ObjectId, ref: "User", default: null },
    updated_by: { type: mongoose.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "roles",
  },
);

/**
 * 🔥 Perbaikan ERR_REQUIRE_ESM
 * Menggunakan Dynamic Import agar CommonJS dapat membaca package ESM
 */
import("mongoose-unique-validator")
  .then((module) => {
    const uniqueValidator = module.default;
    RoleSchema.plugin(uniqueValidator, {
      message: "Role name must be unique!",
    });
  })
  .catch((err) => {
    console.error("❌ Gagal memuat mongoose-unique-validator:", err);
  });

RoleSchema.pre("validate", function (next) {
  if (!this.slug && this.name) {
    this.slug = globalService.createSlug(this.name);
  }
  next();
});

module.exports = model("Role", RoleSchema);
