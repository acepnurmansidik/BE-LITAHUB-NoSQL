const mongoose = require("mongoose");
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

// Collection tersendiri: satu dokumen = satu modul milik sebuah Role
const RoleModuleSchema = new Schema(
  {
    role_id: {
      type: Schema.Types.ObjectId,
      ref: "Role",
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    title: { type: String, required: true },
    permission: [RolePermissionSchema],
    is_delete: { type: Boolean, required: true, default: false },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "role_modules",
  },
);

module.exports =
  mongoose.models.RoleModule || model("RoleModule", RoleModuleSchema);
