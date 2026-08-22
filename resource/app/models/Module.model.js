const mongoose = require("mongoose");
const { model, Schema } = mongoose;

// Sub-Schema untuk SubMenu
const SubMenuSchema = new Schema(
  {
    name: { type: String, required: true },
    path: { type: String, required: true },
    actions: { type: [String], default: [] }, // Array of strings: ["view", "create"]
  },
  { _id: false },
);

// Sub-Schema untuk Menu (Permission)
const PermissionSchema = new Schema(
  {
    icon: { type: String, required: true },
    menu_name: { type: String, required: true },
    path: { type: String, required: true },
    actions: { type: [String], default: [] }, // Array of strings: ["view", "create"]
    // Urutan tampil halaman dalam sebuah module (makin kecil makin atas) —
    // sama fungsinya seperti `sequence` pada level module.
    sequence: { type: Number, default: 0 },
    children: [SubMenuSchema],
  },
  { _id: false },
);

// Skema Utama Module
const ModuleSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    // Urutan tampil module (makin kecil makin atas)
    sequence: { type: Number, default: 0 },
    permission: [PermissionSchema],
    is_delete: { type: Boolean, default: false },
    created_by: { type: mongoose.Types.ObjectId, ref: "User", default: null },
    updated_by: { type: mongoose.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "modules",
  },
);

module.exports = model("Module", ModuleSchema);
