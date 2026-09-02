const Authchema = require("./auth.schema");
const RefParameterSchema = require("./ReffParameter.schema");
const AppConfigSchema = require("./appConfig.schema");
const FormulaSchema = require("./formula.schema");
const LayoutComponentSchema = require("./LayoutComponent.schema");
const InventorySchema = require("./inventory.schema");
const DepartmentSchema = require("./Department.schema");
const FinanceSchema = require("./finance.schema");
const ProcurementSchema = require("./procurement.schema");
const SecuritySchema = require("./security.schema");
const UtilityFormulaSchema = require("./utilityFormula.schema");
const VehicleRateSchema = require("./vehicleRate.schema");
const VehicleUtilitySchema = require("./vehicleUtility.schema");
const WaterMeterSchema = require("./waterMeter.schema");
const ElectricMeterSchema = require("./electricMeter.schema");
const OwnershipSchema = require("./ownership.schema");

const GlobalSchema = {
  ...Authchema.Register,
  ...Authchema.Login,
  ...Authchema.ForgotPassword,
  ...RefParameterSchema,
  ...AppConfigSchema,
  ...FormulaSchema,
  ...LayoutComponentSchema,
  ...InventorySchema,
  ...DepartmentSchema,
  ...FinanceSchema,
  ...ProcurementSchema,
  ...SecuritySchema,
  ...UtilityFormulaSchema,
  ...VehicleRateSchema,
  ...VehicleUtilitySchema,
  ...WaterMeterSchema,
  ...ElectricMeterSchema,
  ...OwnershipSchema,
};

module.exports = GlobalSchema;
