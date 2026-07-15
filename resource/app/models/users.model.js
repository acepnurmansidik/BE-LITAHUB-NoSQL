const mongoose = require("mongoose");
const { model, Schema } = mongoose;

const SysUserModel = Schema(
  {
    auth_id: {
      type: mongoose.Types.ObjectId,
      ref: "sys_auth_user",
      require: true,
      unique: true,
    },
    name: {
      type: String,
      minlength: [3, "Panjang name minimal 3 karakter"],
      required: [true, "Name can't be empty"],
    },
    role_id: {
      type: mongoose.Types.ObjectId,
      ref: "Role",
      require: true,
    },
    device_token: {
      type: String,
      required: [false, "Device token can't be empty"],
      default: "",
    },

    is_delete: { type: Boolean, required: true, default: false },
    created_by: { type: mongoose.Types.ObjectId, ref: "User", default: null },
    updated_by: { type: mongoose.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    versionKey: false,
    new: true,
    collection: "users",
  },
);

module.exports = model("User", SysUserModel);
