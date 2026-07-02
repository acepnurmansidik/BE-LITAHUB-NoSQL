const mongoose = require("mongoose");
const { model, Schema } = mongoose;

const LogActivitiesModel = Schema(
  {
    type: {
      type: String,
      enum: ["CREATE", "UPDATE", "DELETE"],
    },
    before: {
      type: Schema.Types.Mixed,
      default: null,
    },
    after: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  { _id: false },
);

const LogActionModel = Schema(
  {
    target_id: {
      type: Schema.Types.ObjectId,
    },
    source: {
      type: String,
      default: "",
    },
    activities: [LogActivitiesModel],
  },
  {
    // PERBAIKAN DI SINI:
    // Mengubah default nama timestamps Mongoose menjadi snake_case
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    versionKey: false,
    collection: "log_actions",
  },
);

module.exports = model("LogAction", LogActionModel);
