const express = require("express");
const router = express.Router();

const authRouter = require("../resource/app/router/auth.routes");
const userRouter = require("../resource/app/router/user.routes");
const roleRouter = require("../resource/app/router/role.routes");
const moduleRouter = require("../resource/app/router/module.routes");
const refparamRouter = require("../resource/app/router/reffParam.routes");
const appConfigRouter = require("../resource/app/router/appConfig.routes");
const componentFormulaRouter = require("../resource/app/router/componentFormula.routes");
const calculatedFormulaRouter = require("../resource/app/router/calculatedFormula.routes");
const AuthorizeUserLogin = require("../resource/middleware/authentification");

router.use("/app-configs", appConfigRouter);
router.use("/auth", authRouter);
router.use("/role", roleRouter);
router.use("/users", userRouter);
router.use("/module", moduleRouter);
router.use("/ref-parameter", refparamRouter);
router.use("/component-formula", componentFormulaRouter);
router.use("/calculated-formula", calculatedFormulaRouter);
router.use(AuthorizeUserLogin);

module.exports = router;
