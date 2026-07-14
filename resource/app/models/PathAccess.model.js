const mongoose = require("mongoose");
const { model, Schema } = mongoose;

// Collection tersendiri: satu dokumen = satu path access milik sebuah Role
const PathAccessSchema = new Schema(
  {
    role_id: {
      type: Schema.Types.ObjectId,
      ref: "Role",
      required: true,
      index: true,
    },
    path: { type: String, required: true },
    actions: { type: Map, of: Boolean, default: {} }, // Record<string, boolean>
    is_delete: { type: Boolean, required: true, default: false },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "path_accesses",
  },
);

module.exports =
  mongoose.models.PathAccess || model("PathAccess", PathAccessSchema);
