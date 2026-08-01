const mongoose = require("mongoose");

const UomSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "UOM name is required"],
      trim: true, // Example: "Pieces", "Kilogram"
    },
    code: {
      type: String,
      required: [true, "UOM code is required"],
      unique: true,
      trim: true,
      uppercase: true, // Example: PCS, KG
    },
    description: {
      type: String,
      trim: true,
      default: "",
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
    collection: "uoms",
  },
);

module.exports = mongoose.models.Uom || mongoose.model("Uom", UomSchema);
