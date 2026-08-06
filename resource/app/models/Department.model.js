const mongoose = require("mongoose");
const { model, Schema } = mongoose;

const DepartmentSchema = new Schema(
  {
    // Nomor unik, dibuat otomatis controller (mis. "PR-202607-0001").
    name: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    head_of_department_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [false, "Head Department is require!"],
    },
    is_delete: { type: Boolean, required: true, default: false },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "department",
  },
);

module.exports =
  mongoose.models.Department || model("Department", DepartmentSchema);
