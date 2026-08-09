const mongoose = require("mongoose");
const { model, Schema } = mongoose;

// ============================================================
// DELIVERY ORDER (DO) — dokumen pengeluaran barang STANDALONE (tidak
// berelasi ke PR/PO/GR). Mencatat barang yang dikirim keluar dari sebuah
// gudang sumber. Detail item ada di koleksi `detail_product_items`
// (foreignField: delivery_order_id) via virtual `items` — memakai pola
// shared-doc yang sama seperti PR/PO/GR, namun tiap baris hanya menempel
// ke DO ini.
//  - delivery_no  : nomor auto (DO-YYYYMM-#####),
//  - warehouse_id : gudang sumber (stok dikurangi dari sini saat dikirim),
//  - status       : PENDING (default) -> SHIPPED (via aksi "Kirim Barang").
//                   Saat SHIPPED: stok gudang berkurang & StockMovement OUT
//                   dibuat. Setelah SHIPPED dokumen dikunci.
// ============================================================
const DeliveryOrderSchema = new Schema(
  {
    delivery_no: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    date: { type: Date, required: [true, "Date is required!"] },
    delivery_date: { type: Date, default: null },
    // Tujuan / penerima pengiriman (opsional, teks bebas).
    recipient: { type: String, default: "", trim: true },
    reference: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    // Gudang sumber — stok item dikurangi dari gudang ini saat DO dikirim.
    warehouse_id: {
      type: Schema.Types.ObjectId,
      ref: "Warehouse",
      default: null,
    },
    status: {
      type: String,
      enum: ["PENDING", "SHIPPED"],
      default: "PENDING",
      uppercase: true,
    },

    is_delete: { type: Boolean, default: false },
    created_by: { type: mongoose.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "delivery_order",
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

DeliveryOrderSchema.virtual("items", {
  ref: "DetailProductItem",
  localField: "_id",
  foreignField: "delivery_order_id",
  justOne: false,
});

module.exports =
  mongoose.models.DeliveryOrder || model("DeliveryOrder", DeliveryOrderSchema);
