const mongoose = require("mongoose");
const { model, Schema } = mongoose;

// ============================================================
// INVENTORY SEQUENCE — penyimpan nomor urut (running number) KHUSUS inventory,
// terpisah dari koleksi `sequence` (finance). Di-key oleh string bebas:
//   - Product : "PRODUCT:<productCategoryId>"  (urut per kategori)
//   - Supplier: "SUPPLIER"                      (urut global)
// Increment ATOMIK (findOneAndUpdate + $inc + upsert) → aman dari race.
// ============================================================
const InventorySequenceSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    seq: { type: Number, required: true, default: 0 },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "inventory_sequences",
  },
);

module.exports =
  mongoose.models.InventorySequence ||
  model("InventorySequence", InventorySequenceSchema);
