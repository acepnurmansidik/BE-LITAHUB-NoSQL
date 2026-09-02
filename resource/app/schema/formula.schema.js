const FormulaSchema = {
  // rate_type: FIXED | CALCULATED | EXTERNAL | PERCENTAGE.
  // EXTERNAL → komponen hanya menyimpan rate (calculated_rate). Nilai luar "x"
  // & operator penggabungnya ditentukan pada token ekspresi CalculatedFormula
  // (lihat x_operator pada token), bukan di sini.
  // PERCENTAGE → angka persen disimpan di fixed_rate (mis. 11 = 11%). Nilai
  // operand efektif di CalculatedFormula = fixed_rate / 100 (dipakai sbg pengali).
  BodyComponentFormulaSchema: {
    name: "base tax",
    rate_type: "FIXED",
    fixed_rate: 1000,
    calculated_rate: 0,
    decimal_place: 2,
    accounts: ["CHART_OF_ACCOUNT_ID_1"],
  },
  // calc_type "SINGLE" (Ekspresi Tunggal): satu `expression` (deretan token
  // infix, mendukung prioritas operator & kurung). Contoh setara: ( base + admin ) * 0.5
  BodyCalculatedFormulaSchema: {
    name: "total tax",
    calc_type: "SINGLE",
    decimal_place: 2,
    rounding: "round",
    // Akun hasil akhir (SINGLE hanya di sini).
    accounts: ["CHART_OF_ACCOUNT_ID_1"],
    // FORMULA_COMPONENT | COMPONENT_DETAIL
    account_assignment: "FORMULA_COMPONENT",
    expression: [
      { type: "paren", paren: "(" },
      { type: "component", component: "COMPONENT_FORMULA_ID_1" },
      { type: "operator", operator: "+" },
      { type: "component", component: "COMPONENT_FORMULA_ID_2" },
      { type: "paren", paren: ")" },
      { type: "operator", operator: "*" },
      { type: "constant", value: 0.5 },
    ],
  },
  // calc_type "PER_COMPONENT" (Per Komponen): beberapa komponen bernama, tiap
  // komponen punya ekspresi & pembulatan sendiri, dihitung terpisah lalu
  // seluruh hasilnya DIJUMLAHKAN menjadi hasil akhir.
  BodyCalculatedFormulaPerComponentSchema: {
    name: "total payroll",
    calc_type: "PER_COMPONENT",
    decimal_place: 2,
    rounding: "round",
    // Akun hasil akhir (PER_COMPONENT: di sini DAN di tiap komponen).
    accounts: ["CHART_OF_ACCOUNT_ID_FINAL"],
    // FORMULA_COMPONENT | COMPONENT_DETAIL
    account_assignment: "COMPONENT_DETAIL",
    components: [
      {
        name: "Penghasilan",
        decimal_place: 2,
        rounding: "round",
        component_line: "COMPONENT_FORMULA_ID_1",
        accounts: ["CHART_OF_ACCOUNT_ID_1"],
        expression: [
          { type: "component", component: "COMPONENT_FORMULA_ID_1" },
          { type: "operator", operator: "+" },
          { type: "component", component: "COMPONENT_FORMULA_ID_2" },
        ],
      },
      {
        name: "Potongan Pajak",
        decimal_place: 0,
        rounding: "down",
        component_line: "COMPONENT_FORMULA_ID_1",
        accounts: ["CHART_OF_ACCOUNT_ID_2"],
        expression: [
          { type: "component", component: "COMPONENT_FORMULA_ID_1" },
          { type: "operator", operator: "*" },
          { type: "constant", value: -0.05 },
        ],
      },
    ],
  },
};

module.exports = FormulaSchema;
