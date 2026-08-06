const mongoose = require("mongoose");
const { model, Schema } = mongoose;

const ImageSchema = Schema(
  {
    path: {
      type: String,
      required: [true, "Value harus diisi"],
    },
    status: {
      type: Boolean,
      default: false,
    },
    source_id: {
      type: mongoose.Types.ObjectId,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    new: true,
    collection: "images",
  },
);

module.exports =
  mongoose.models.ImageSchema || mongoose.model("Image", ImageSchema);
