const mongoose = require("mongoose");
const globalService = require("../../helper/global-func");
const { model, Schema } = mongoose;

// Sub-schema: satu TOKEN di dalam ekspresi formula.
// Ekspresi disimpan sebagai deretan token bergaya "infix" sehingga mendukung
// prioritas operator (perkalian/pembagian sebelum penjumlahan/pengurangan)
// dan pengelompokan dengan tanda kurung — persis aturan matematika.
//
// Jenis token:
//  - "component" : operand yang mereferensikan sebuah ComponentFormula (rate).
//  - "constant"  : operand berupa angka literal (mis. 0.5, 1000).
//  - "operator"  : + - * /
//  - "paren"     : "(" atau ")"
const TokenSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["component", "constant", "operator", "paren"],
      required: [true, "Token type is required!"],
    },
    // type === "component"
    component: {
      type: Schema.Types.ObjectId,
      ref: "ComponentFormula",
    },
    // type === "constant"
    value: {
      type: Number,
    },
    // type === "operator"
    operator: {
      type: String,
      enum: ["+", "-", "*", "/"],
    },
    // type === "paren"
    paren: {
      type: String,
      enum: ["(", ")"],
    },
    // Khusus paren "(" : jumlah angka di belakang koma untuk hasil GRUP kurung
    // ini. Dinamis per kurung — tiap "(" boleh punya decimal_place berbeda.
    // Diabaikan pada ")". Bila kosong, evaluator jatuh ke decimal_place formula.
    decimal_place: {
      type: Number,
      min: [0, "Decimal place cannot be negative"],
      validate: {
        validator: (v) => v == null || Number.isInteger(v),
        message: "Decimal place must be an integer",
      },
    },
    // Khusus paren "(" : arah pembulatan hasil GRUP kurung ini.
    //  round = terdekat, up = ke atas, down = ke bawah, none = nilai asli.
    rounding: {
      type: String,
      enum: ["round", "up", "down", "none"],
    },
  },
  { _id: false },
);

const CalculatedFormulaSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required!"],
    },
    slug: {
      type: String,
      minlength: [3, "Slug must be at least 3 characters long"],
      required: [true, "Slug is required!"],
      unique: true,
      trim: true,
      lowercase: true,
    },
    // Ekspresi formula sebagai deretan token (lihat TokenSchema).
    // Dievaluasi dengan shunting-yard (prioritas operator + kurung).
    expression: {
      type: [TokenSchema],
      validate: {
        validator: (v) =>
          Array.isArray(v) &&
          v.some((t) => t.type === "component" || t.type === "constant"),
        message: "At least one operand (component/number) is required!",
      },
    },
    // Jumlah angka di belakang koma untuk hasil akhir & tiap grup kurung.
    // Model ini hanya menyimpan DEFINISI formula, bukan hasil hitung — hasil
    // dihitung dinamis (client) karena bergantung pada rate komponen terkini.
    decimal_place: {
      type: Number,
      default: 2,
      min: [0, "Decimal place cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "Decimal place must be an integer",
      },
    },
    // Arah pembulatan HASIL AKHIR formula.
    //  round = terdekat (default), up = ke atas, down = ke bawah,
    //  none = nilai asli (tanpa pembulatan).
    rounding: {
      type: String,
      enum: ["round", "up", "down", "none"],
      default: "round",
    },
    is_delete: { type: Boolean, required: true, default: false },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "calculated_formula",
  },
);

CalculatedFormulaSchema.pre("validate", function (next) {
  if (!this.slug && this.name) {
    this.slug = globalService.createSlug(this.name);
  }
});

module.exports =
  mongoose.models.CalculatedFormula ||
  model("CalculatedFormula", CalculatedFormulaSchema);
