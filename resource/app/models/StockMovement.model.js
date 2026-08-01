const mongoose = require("mongoose");

const StockMovementSchema = new mongoose.Schema(
  {
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product reference is required"],
    },
    warehouse_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: [true, "Warehouse reference is required"],
    },
    // Gudang tujuan — dipakai saat type TRANSFER.
    destination_warehouse_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      default: null,
    },
    uom_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Uom",
      default: null,
    },
    type: {
      type: String,
      enum: ["IN", "OUT", "ADJUSTMENT", "TRANSFER"],
      required: [true, "Movement type is required"],
      uppercase: true,
    },
    quantity: {
      type: Number,
      required: [true, "Quantity is required"],
    },
    reference: {
      type: String,
      trim: true,
      default: "",
    },
    date: {
      type: Date,
      default: Date.now,
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
    is_delete: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "stock_movements",
  },
);

module.exports =
  mongoose.models.StockMovement ||
  mongoose.model("StockMovement", StockMovementSchema);
