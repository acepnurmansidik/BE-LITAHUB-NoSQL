const mongoose = require("mongoose");

const StockPositionSchema = new mongoose.Schema(
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
    uom_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Uom",
      default: null,
    },
    quantity: {
      type: Number,
      default: 0,
    },
    reserved_quantity: {
      type: Number,
      default: 0,
    },
    is_delete: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "stock_positions",
  },
);

// Satu posisi stok unik per kombinasi produk & gudang.
StockPositionSchema.index({ product_id: 1, warehouse_id: 1 }, { unique: true });

module.exports =
  mongoose.models.StockPosition ||
  mongoose.model("StockPosition", StockPositionSchema);
