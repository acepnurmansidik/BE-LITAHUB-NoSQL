const FormulaSchema = {
  BodyComponentFormulaSchema: {
    name: "base tax",
    rate_type: "FIXED",
    fixed_rate: 1000,
    calculated_rate: 0,
    decimal_place: 2,
  },
  // Ekspresi = deretan token infix (mendukung prioritas operator & kurung).
  // Contoh di bawah setara: ( base + admin ) * 0.5
  BodyCalculatedFormulaSchema: {
    name: "total tax",
    decimal_place: 2,
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
};

module.exports = FormulaSchema;
