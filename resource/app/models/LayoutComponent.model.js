const mongoose = require("mongoose");
const { model, Schema } = mongoose;

const LayoutComponentSchema = Schema(
  {
    category: {
      type: String,
      enum: ["SHAPES", "TABLES"],
      default: "SHAPES",
      uppercase: true,
    },
    name: {
      type: String,
      required: [true, "Name is required!"],
    },
    image_id: {
      type: mongoose.Types.ObjectId,
      ref: "Image",
      default: null,
    },

    is_delete: { type: Boolean, required: true, default: false },
    created_by: { type: mongoose.Types.ObjectId, ref: "User", default: null },
    updated_by: { type: mongoose.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    versionKey: false,
    new: true,
    collection: "component_layouts",
  },
);

module.exports =
  mongoose.models.LayoutComponent ||
  mongoose.model("LayoutComponent", LayoutComponentSchema);
