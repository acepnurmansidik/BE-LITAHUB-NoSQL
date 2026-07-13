const Authchema = require("./auth.schema");
const RefParameterSchema = require("./ReffParameter.schema");

const GlobalSchema = {
  ...Authchema.Register,
  ...Authchema.Login,
  ...Authchema.ForgotPassword,
  ...RefParameterSchema,
};

module.exports = GlobalSchema;
