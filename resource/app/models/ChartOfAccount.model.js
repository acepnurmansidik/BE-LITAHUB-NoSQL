const mongoose = require("mongoose");
const { model, Schema } = mongoose;

// ============================================================
// CHART OF ACCOUNT (COA) — Finance
// Hierarki BERTINGKAT TAK TERBATAS (dinamis) namun tetap dalam SATU collection
// memakai pola adjacency-list: tiap akun menyimpan `parent_id` (self-ref).
// Untuk mempermudah sorting/tampilan pohon & breadcrumb, ikut disimpan:
//   - level : kedalaman akun (root = 1)
//   - path  : materialized path dari kode leluhur→diri, mis. "1000.1100.1110"
//
// Penanda penting:
//   - is_header      : TRUE = akun grup/header (tidak untuk posting, hanya
//                      pengelompok). Hanya header yang boleh punya anak.
//   - type           : kategori akun (ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE).
//   - normal_balance : DEBIT/CREDIT — ditetapkan otomatis dari `type`.
// ============================================================
const ChartOfAccountSchema = new Schema(
  {
    // Nomor/kode akun, unik. Dipakai juga sebagai penyusun `path`.
    code: {
      type: String,
      required: [true, "Account code is required!"],
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, "Account name is required!"],
      trim: true,
    },
    type: {
      type: String,
      enum: [
        "ASSET",
        "LIABILITY",
        "EQUITY",
        "REVENUE",
        "EXPENSE",
        "CAPITAL",
        "SALES",
        "COGS",
        "OTHER_INCOME_EXPENSE",
        "ADM_OPERATION_EXPENSE",
        "DEPRECIATION_AMORTIZATION",
        "OTHERS",
      ],
      required: [true, "Account type is required!"],
      uppercase: true,
    },
    // Saldo normal akun — diturunkan otomatis dari `type` oleh controller.
    normal_balance: {
      type: String,
      enum: ["DEBIT", "CREDIT"],
      required: true,
    },
    // Penanda akun header/grup (bukan akun postable).
    is_header: {
      type: Boolean,
      required: true,
      default: false,
    },
    // Referensi ke akun induk (null = akun root). Self-reference → hierarki
    // dinamis tak terbatas dalam satu collection.
    parent_id: {
      type: Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    // Kedalaman akun; root = 1. Dikelola otomatis oleh controller.
    level: {
      type: Number,
      default: 1,
      min: [1, "Level cannot be less than 1"],
    },
    // Materialized path kode (mis. "1000.1100.1110"). Dikelola otomatis oleh
    // controller & ikut di-cascade ke turunan saat kode/parent berubah.
    path: {
      type: String,
      default: "",
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    is_delete: { type: Boolean, required: true, default: false },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "chart_of_account",
  },
);

module.exports =
  mongoose.models.ChartOfAccount ||
  model("ChartOfAccount", ChartOfAccountSchema);
