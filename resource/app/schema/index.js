const Authchema = require("./auth.schema");
const RefParameterSchema = require("./ReffParameter.schema");
const AppConfigSchema = require("./appConfig.schema");
const FormulaSchema = require("./formula.schema");
const FacilitySchema = require("./branch.schema");
const LayoutComponentSchema = require("./LayoutComponent.schema");
const InventorySchema = require("./inventory.schema");

const GlobalSchema = {
  ...Authchema.Register,
  ...Authchema.Login,
  ...Authchema.ForgotPassword,
  ...RefParameterSchema,
  ...AppConfigSchema,
  ...FormulaSchema,
  ...FacilitySchema,
  ...LayoutComponentSchema,
  ...InventorySchema,
};

module.exports = GlobalSchema;
