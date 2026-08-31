const mongoose = require("mongoose");

const UtilityFormulaSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, "code is required"],
      unique: true,
      trim: true,
      uppercase: true, // Example: YYYY
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, "name is required"],
      trim: true,
      uppercase: true, // Example: YEAR
    },
    is_delete: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "utility_formula",
  },
);

module.exports =
  mongoose.models.UtilityFormula ||
  mongoose.model("UtilityFormula", UtilityFormulaSchema);
