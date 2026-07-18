const Authchema = require("./auth.schema");
const RefParameterSchema = require("./ReffParameter.schema");
const AppConfigSchema = require("./appConfig.schema");
const FormulaSchema = require("./formula.schema");

const GlobalSchema = {
  ...Authchema.Register,
  ...Authchema.Login,
  ...Authchema.ForgotPassword,
  ...RefParameterSchema,
  ...AppConfigSchema,
  ...FormulaSchema,
};

module.exports = GlobalSchema;
