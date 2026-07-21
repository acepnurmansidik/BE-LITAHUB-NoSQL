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
    // Khusus token "component" yang menunjuk ComponentFormula bertipe EXTERNAL:
    // operator penggabung nilai LUAR "x" dengan rate komponen (default "+").
    // Rate efektif operand = x  {x_operator}  rate. Diabaikan untuk tipe lain.
    x_operator: {
      type: String,
      enum: ["+", "-", "*", "/"],
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
    // Tipe perhitungan formula:
    //  - "SINGLE"        : Ekspresi Tunggal. Satu `expression` (deretan token)
    //                      dihitung utuh dengan prioritas operator + kurung.
    //  - "PER_COMPONENT" : Per Komponen. Formula tersusun dari beberapa KOMPONEN
    //                      bernama (koleksi calculated_formula_component). Tiap
    //                      komponen punya ekspresi & pembulatan SENDIRI, dihitung
    //                      TERPISAH, lalu SELURUH hasilnya DIJUMLAHKAN.
    calc_type: {
      type: String,
      enum: ["SINGLE", "PER_COMPONENT"],
      default: "SINGLE",
      uppercase: true,
    },
    // Ekspresi formula sebagai deretan token (lihat TokenSchema).
    // Dievaluasi dengan shunting-yard (prioritas operator + kurung).
    // Hanya dipakai saat calc_type === "SINGLE".
    expression: {
      type: [TokenSchema],
      validate: {
        validator: function (v) {
          // Pada mode PER_COMPONENT, ekspresi induk tidak dipakai (kosong) —
          // perhitungan ada di tiap komponen. Validasi operand hanya untuk SINGLE.
          if (this && this.calc_type === "PER_COMPONENT") return true;
          return (
            Array.isArray(v) &&
            v.some((t) => t.type === "component" || t.type === "constant")
          );
        },
        message: "At least one operand (component/number) is required!",
      },
    },
    // Daftar akun (Chart of Account) untuk HASIL AKHIR formula.
    // SINGLE      : hanya di sini (hasil akhir).
    // PER_COMPONENT: di sini (hasil akhir) DAN di tiap komponen (accounts-nya).
    // Diposisikan di atas `components` sesuai kebutuhan.
    accounts: {
      type: [{ type: Schema.Types.ObjectId, ref: "ChartOfAccount" }],
      default: [],
    },
    // Menentukan jenis akun yang dipakai saat nilai formula di-assign:
    //  - FORMULA_COMPONENT : assign ke akun yang di-set pada formula ini
    //                        (accounts formula / accounts tiap komponen formula).
    //  - COMPONENT_DETAIL  : assign ke akun tiap ComponentFormula detail yang
    //                        dipakai (accounts yang di-set di koleksi
    //                        component_formula).
    account_assignment: {
      type: String,
      enum: ["FORMULA_COMPONENT", "COMPONENT_DETAIL"],
      default: "FORMULA_COMPONENT",
      uppercase: true,
    },
    // Daftar KOMPONEN formula (ref calculated_formula_component). Hanya dipakai
    // saat calc_type === "PER_COMPONENT". Diisi/di-maintain oleh controller.
    components: {
      type: [{ type: Schema.Types.ObjectId, ref: "CalculatedFormulaComponent" }],
      default: [],
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

const CalculatedFormulaModel =
  mongoose.models.CalculatedFormula ||
  model("CalculatedFormula", CalculatedFormulaSchema);

// Ekspor TokenSchema agar sub-model (CalculatedFormulaComponent) memakai bentuk
// token yang sama persis dengan ekspresi induk.
module.exports = CalculatedFormulaModel;
module.exports.TokenSchema = TokenSchema;
