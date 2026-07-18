const mongoose = require("mongoose");
const globalService = require("../../helper/global-func");
const { model, Schema } = mongoose;

const ComponentFormulaSchema = new Schema(
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
    rate_type: {
      type: String,
      enum: ["FIXED", "CALCULATED"],
      default: "FIXED",
      uppercase: true, // Memastikan data tersimpan sebagai uppercase
    },
    fixed_rate: {
      type: Number,
      default: 0,
    },
    calculated_rate: {
      type: Number,
      default: 0,
    },
    // Jumlah angka di belakang koma yang dipakai saat me-round rate komponen ini.
    // Nilai ini ikut mempengaruhi hasil perhitungan di CalculatedFormula.
    decimal_place: {
      type: Number,
      default: 2,
      min: [0, "Decimal place cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "Decimal place must be an integer",
      },
    },
    // Daftar CalculatedFormula (data master) yang sedang memakai komponen ini.
    // Dikelola otomatis oleh controller CalculatedFormula saat create/update/delete.
    // Selama array ini tidak kosong, komponen tidak boleh dihapus.
    component_id: {
      type: [{ type: Schema.Types.ObjectId, ref: "CalculatedFormula" }],
      default: [],
    },
    is_delete: { type: Boolean, required: true, default: false },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "component_formula",
  },
);

ComponentFormulaSchema.pre("validate", function (next) {
  if (!this.slug && this.name) {
    this.slug = globalService.createSlug(this.name);
  }
});

module.exports =
  mongoose.models.ComponentFormula ||
  model("ComponentFormula", ComponentFormulaSchema);
