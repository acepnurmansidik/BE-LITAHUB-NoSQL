const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const ReffParamSchema = new Schema(
  {
    key: {
      type: Number,
      required: [true, "Key harus diisi"],
    },
    value: {
      type: String,
      trim: true,
      minlength: [3, "Panjang minimal 3 karakter"],
      required: [true, "Value harus diisi"],
      unique: true,
    },
    type: {
      type: String,
      trim: true,
      minlength: [3, "Panjang type minimal 3 karakter"],
      required: [true, "Type harus diisi"],
    },
    description: {
      type: String,
      trim: true,
      required: [true, "Description harus diisi"],
    },
    is_delete: {
      type: Boolean,
      default: false,
    },
    icon_id: {
      type: Schema.Types.ObjectId,
      ref: "Image",
      default: null,
    },
    parent_id: {
      type: Schema.Types.ObjectId,
      ref: "ReffParameter",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: "reff_parameters",
  },
);

// Optional: Index agar pencarian berdasarkan type lebih cepat
ReffParamSchema.index({ type: 1 });
ReffParamSchema.index({ parent_id: 1 });

module.exports =
  mongoose.models.ReffParameter || model("ReffParameter", ReffParamSchema);
