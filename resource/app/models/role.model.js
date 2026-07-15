const mongoose = require("mongoose");
const globalService = require("../../helper/global-func");
const { model, Schema } = mongoose;

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
    // Referensi ke collection tersendiri (dinormalisasi)
    has_access_module: [{ type: Schema.Types.ObjectId, ref: "RoleModule" }],
    path_access: [{ type: Schema.Types.ObjectId, ref: "PathAccess" }],

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

// Keunikan slug sudah dijamin oleh `unique: true` (index unik MongoDB),
// jadi tidak perlu plugin tambahan.

RoleSchema.pre("validate", function (next) {
  if (!this.slug && this.name) {
    this.slug = globalService.createSlug(this.name);
  }
  // next();
});

module.exports = mongoose.models.Role || model("Role", RoleSchema);
