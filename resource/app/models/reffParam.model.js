const mongoose = require("mongoose");
const { model, Schema } = mongoose;

const ReffParamSchema = Schema(
  {
    key: {
      type: Number,
    },
    value: {
      type: String,
      minlength: [1, "Panjang minimal 3 karakter"],
      required: [true, "Value harus diisi"],
      unique: true,
    },
    type: {
      type: String,
      minlength: [3, "Panjang type minimal 3 karakter"],
      required: [true, "password harus diisi"],
    },
    description: {
      type: String,
      required: [true, "password harus diisi"],
    },
    is_delete: {
      type: Boolean,
      default: false,
    },
    icon_id: {
      type: mongoose.Types.ObjectId,
      ref: "Image",
      default: null,
    },
    parent_id: {
      type: mongoose.Types.ObjectId,
      ref: "ReffParameter",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    new: true,
    collection: "reff_parameters",
  },
);

module.exports = model("ReffParameter", ReffParamSchema);
