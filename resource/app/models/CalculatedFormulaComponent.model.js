const mongoose = require("mongoose");
const { model, Schema } = mongoose;
// Pakai bentuk token yang sama persis dengan ekspresi induk (CalculatedFormula).
const { TokenSchema } = require("./CalculatedFormula.model");

// ============================================================
// CALCULATED FORMULA COMPONENT — "Komponen" untuk formula tipe PER_COMPONENT.
//
// Satu dokumen = SATU komponen bernama milik sebuah CalculatedFormula
// (calc_type === "PER_COMPONENT"). Tiap komponen membawa ekspresinya sendiri
// (deretan token, sama seperti ekspresi tunggal) beserta pembulatannya sendiri.
//
// Alur perhitungan PER_COMPONENT: tiap komponen dihitung TERPISAH memakai
// decimal_place & rounding-nya masing-masing, lalu SELURUH hasil komponen
// DIJUMLAHKAN menjadi hasil akhir formula induk.
//
// Koleksi ini di-assign ke field `components` pada master CalculatedFormula
// dan dikelola sepenuhnya lewat controller CalculatedFormula (bukan CRUD lepas).
// ============================================================
const CalculatedFormulaComponentSchema = new Schema(
  {
    // Nama komponen (mis. "Gaji Pokok", "Tunjangan", "Potongan").
    name: {
      type: String,
      required: [true, "Component name is required!"],
      trim: true,
    },
    // Induk formula pemilik komponen ini.
    calculated_formula_id: {
      type: Schema.Types.ObjectId,
      ref: "CalculatedFormula",
      required: [true, "Parent calculated formula is required!"],
      index: true,
    },
    // ObjectId ComponentFormula yang ditambahkan pada baris/komponen ini.
    component_line: {
      type: Schema.Types.ObjectId,
      ref: "ComponentFormula",
    },
    // Daftar akun (Chart of Account) yang terkait komponen ini.
    accounts: {
      type: [{ type: Schema.Types.ObjectId, ref: "ChartOfAccount" }],
      default: [],
    },
    // Ekspresi komponen (deretan token infix, prioritas operator + kurung).
    expression: {
      type: [TokenSchema],
      validate: {
        validator: (v) =>
          Array.isArray(v) &&
          v.some((t) => t.type === "component" || t.type === "constant"),
        message: "At least one operand (component/number) is required!",
      },
    },
    // Pembulatan HASIL komponen ini (independen dari komponen lain & induk).
    decimal_place: {
      type: Number,
      default: 2,
      min: [0, "Decimal place cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "Decimal place must be an integer",
      },
    },
    rounding: {
      type: String,
      enum: ["round", "up", "down", "none"],
      default: "round",
    },
    // Urutan tampil komponen dalam formula induk.
    order: { type: Number, default: 0 },
    is_delete: { type: Boolean, required: true, default: false },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "calculated_formula_component",
  },
);

module.exports =
  mongoose.models.CalculatedFormulaComponent ||
  model("CalculatedFormulaComponent", CalculatedFormulaComponentSchema);
