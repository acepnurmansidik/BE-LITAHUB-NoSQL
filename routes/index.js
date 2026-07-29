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
const chartOfAccountRouter = require("../resource/app/router/chartOfAccount.routes");
const journalEntryRouter = require("../resource/app/router/journalEntry.routes");
const accountReceivableRouter = require("../resource/app/router/accountReceivable.routes");
const accountPayableRouter = require("../resource/app/router/accountPayable.routes");
const journalWriteOffRouter = require("../resource/app/router/journalWriteOff.routes");
const branchRouter = require("../resource/app/router/branch.routes");
const buildingRouter = require("../resource/app/router/building.routes");
const buildingFloorRouter = require("../resource/app/router/buildingFloor.routes");
const roomUnitRouter = require("../resource/app/router/roomUnit.routes");
const AuthorizeUserLogin = require("../resource/middleware/authentification");
const LayoutComponentRouter = require("../resource/app/router/layoutComponent.routes");

router.use("/app-configs", appConfigRouter);
router.use("/auth", authRouter);
router.use("/users", userRouter);
router.use("/ref-parameter", refparamRouter);

// SETTING
router.use("/layout-component", LayoutComponentRouter);
router.use("/component-formula", componentFormulaRouter);
router.use("/calculated-formula", calculatedFormulaRouter);
router.use("/role", roleRouter);
router.use("/module", moduleRouter);

// BUILDING / LAYOUT
router.use("/branch", branchRouter);
router.use("/building", buildingRouter);
router.use("/building-floor", buildingFloorRouter);
router.use("/room-unit", roomUnitRouter);

// FINANCE
router.use("/chart-of-account", chartOfAccountRouter);
router.use("/journal-entry", journalEntryRouter);
router.use("/account-receivable", accountReceivableRouter);
router.use("/account-payable", accountPayableRouter);
router.use("/journal-write-off", journalWriteOffRouter);

router.use(AuthorizeUserLogin);

module.exports = router;
