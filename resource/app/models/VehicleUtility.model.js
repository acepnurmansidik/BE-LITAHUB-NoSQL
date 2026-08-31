const mongoose = require("mongoose");

const VehicleUtilitySchema = new mongoose.Schema(
  {
    // VIN atau Vehicle Identification Number
    vin: { type: String, required: true, uppercase: true, unique: true },
    // vehicle_type like: Porche 911, Suzuki R15
    vehicle_type: { type: String, required: true, uppercase: true },
    unit_id: { type: mongoose.Types.ObjectId, ref: "Unit", required: true },
    unit_name: { type: String, required: true },
    rate_id: {
      type: mongoose.Types.ObjectId,
      ref: "VehicleRate",
      required: true,
    },
    is_active: { type: Boolean, default: true, required: true },

    is_delete: { type: Boolean, default: false },
    created_by: { type: mongoose.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "vehicle_utility",
  },
);

module.exports =
  mongoose.models.VehicleUtility ||
  mongoose.model("VehicleUtility", VehicleUtilitySchema);
