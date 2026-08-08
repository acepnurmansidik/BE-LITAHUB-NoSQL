const mongoose = require("mongoose");
const { model, Schema } = mongoose;

// ============================================================
// PURCHASE ITEM — detail item procurement (koleksi terpisah).
// Satu koleksi dipakai bersama oleh Purchase Request / Purchase Order /
// Good Receipt. Tiap baris ditandai oleh SALAH SATU parent id:
//   - purchase_request_id  (baris milik sebuah PR)
//   - purchase_order_id    (baris milik sebuah PO)
//   - good_receipt_id      (baris milik sebuah GR)
// plus referensi product, uom, supplier, quantity, & harga beli per item.
// Kode/nama produk di-snapshot agar riwayat tetap benar walau master berubah.
// ============================================================
const DetailProductItemSchema = new Schema(
  {
    product_id: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product reference is required"],
    },
    // Snapshot dari master product saat baris dibuat.
    product_code: { type: String, default: "", trim: true },
    product_name: { type: String, default: "", trim: true },

    uom_id: { type: Schema.Types.ObjectId, ref: "Uom", default: null },
    supplier_id: {
      type: Schema.Types.ObjectId,
      ref: "Supplier",
      default: null,
    },

    // Parent — hanya salah satu yang terisi sesuai dokumen pemiliknya.
    purchase_request_id: {
      type: Schema.Types.ObjectId,
      ref: "PurchaseRequest",
      default: null,
    },
    purchase_order_id: {
      type: Schema.Types.ObjectId,
      ref: "PurchaseOrder",
      default: null,
    },
    good_receipt_id: {
      type: Schema.Types.ObjectId,
      ref: "GoodReceipt",
      default: null,
    },

    // Gudang penerimaan (khusus item Good Receipt).
    warehouse_id: {
      type: Schema.Types.ObjectId,
      ref: "Warehouse",
      default: null,
    },

    quantity: {
      type: Number,
      default: 0,
      min: [0, "Quantity cannot be negative"],
    },
    // Qty yang benar-benar diterima (khusus Good Receipt). Menentukan status
    // GR & jumlah yang masuk ke stok.
    received_qty: {
      type: Number,
      default: 0,
      min: [0, "Received qty cannot be negative"],
    },
    price: {
      type: Number,
      default: 0,
      min: [0, "Purchase price cannot be negative"],
    },
    subtotal: { type: Number, default: 0 },

    // Siklus status item (English):
    //  PENDING          = baru dibuat di PR, belum masuk PO,
    //  ORDERED          = sudah ditautkan ke PO (dipesan),
    //  PARTIAL_RECEIVED = sebagian qty diterima via Good Receipt,
    //  RECEIVED         = seluruh qty diterima via Good Receipt.
    status: {
      type: String,
      enum: ["PENDING", "ORDERED", "PARTIAL_RECEIVED", "RECEIVED"],
      default: "PENDING",
      uppercase: true,
    },

    is_delete: { type: Boolean, required: true, default: false },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "detail_product_items",
  },
);

module.exports =
  mongoose.models.DetailProductItem ||
  model("DetailProductItem", DetailProductItemSchema);
