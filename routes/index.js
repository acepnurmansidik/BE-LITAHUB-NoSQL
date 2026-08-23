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
const unitRouter = require("../resource/app/router/unit.routes");
const AuthorizeUserLogin = require("../resource/middleware/authentification");
const LayoutComponentRouter = require("../resource/app/router/layoutComponent.routes");
const productCategoryRouter = require("../resource/app/router/productCategory.routes");
const uomRouter = require("../resource/app/router/uom.routes");
const productRouter = require("../resource/app/router/product.routes");
const supplierPricingRouter = require("../resource/app/router/supplierPricing.routes");
const warehouseRouter = require("../resource/app/router/warehouse.routes");
const supplierRouter = require("../resource/app/router/supplier.routes");
const stockPositionRouter = require("../resource/app/router/stockPosition.routes");
const stockMovementRouter = require("../resource/app/router/stockMovement.routes");
const departmentRouter = require("../resource/app/router/department.routes");
const purchaseRequestRouter = require("../resource/app/router/purchaseRequest.routes");
const purchaseOrderRouter = require("../resource/app/router/purchaseOrder.routes");
const goodReceiptRouter = require("../resource/app/router/goodReceipt.routes");
const deliveryOrderRouter = require("../resource/app/router/deliveryOrder.routes");
const uploadRouter = require("../resource/app/router/upload.routes");
const exportImportRouter = require("../resource/app/router/exportImportFile.routes");
const utilityFormulaRouter = require("../resource/app/router/utilityFormula.routes");
const dashboardRouter = require("../resource/app/router/dashboard.routes");

router.use("/app-configs", appConfigRouter);
router.use("/auth", authRouter);
router.use("/users", userRouter);
router.use("/ref-parameter", refparamRouter);
router.use("/department", departmentRouter);

// SETTING
router.use("/layout-component", LayoutComponentRouter);
router.use("/component-formula", componentFormulaRouter);
router.use("/calculated-formula", calculatedFormulaRouter);
router.use("/utility-formula", utilityFormulaRouter);
router.use("/role", roleRouter);
router.use("/module", moduleRouter);

// BUILDING / LAYOUT
router.use("/branch", branchRouter);
router.use("/building", buildingRouter);
router.use("/building-floor", buildingFloorRouter);
router.use("/unit", unitRouter);

// FINANCE
router.use("/chart-of-account", chartOfAccountRouter);
router.use("/journal-entry", journalEntryRouter);
router.use("/account-receivable", accountReceivableRouter);
router.use("/account-payable", accountPayableRouter);
router.use("/journal-write-off", journalWriteOffRouter);

// INVENTORY
router.use("/product-category", productCategoryRouter);
router.use("/uom", uomRouter);
router.use("/product", productRouter);
router.use("/supplier-pricing", supplierPricingRouter);
router.use("/warehouse", warehouseRouter);
router.use("/supplier", supplierRouter);
router.use("/stock-position", stockPositionRouter);
router.use("/stock-movement", stockMovementRouter);

// PROCUREMENT
router.use("/purchase-request", purchaseRequestRouter);
router.use("/purchase-order", purchaseOrderRouter);
router.use("/good-receipt", goodReceiptRouter);
router.use("/delivery-order", deliveryOrderRouter);

// UTILITY
router.use("/upload", uploadRouter);
router.use("/import-export", exportImportRouter);
router.use("/dashboard", dashboardRouter);

router.use(AuthorizeUserLogin);

module.exports = router;
