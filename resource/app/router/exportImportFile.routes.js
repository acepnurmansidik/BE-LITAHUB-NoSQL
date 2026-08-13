const multer = require("multer");
const controller = require("../controller/ExporImportFile.controller");

const router = require("express").Router();

// Keep the upload in memory only (no need to write to disk) — we just read the
// buffer and parse it. Limit 15MB, Excel files only.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok =
      /sheet|excel|spreadsheet|octet-stream/i.test(file.mimetype) ||
      /\.(xlsx|xls)$/i.test(file.originalname);
    if (ok) return cb(null, true);
    cb(new Error("Only .xlsx / .xls files are allowed"));
  },
});

// One endpoint = one function (no dynamic ":module" routing).
// IMPORT — master & stock modules only (they have templates + upsert).
router.post("/product/import", upload.single("file"), controller.importProduct);
router.post(
  "/product-category/import",
  upload.single("file"),
  controller.importProductCategory,
);
router.post("/uom/import", upload.single("file"), controller.importUom);
router.post(
  "/warehouse/import",
  upload.single("file"),
  controller.importWarehouse,
);
router.post(
  "/supplier/import",
  upload.single("file"),
  controller.importSupplier,
);
router.post(
  "/stock-position/import",
  upload.single("file"),
  controller.importStockPosition,
);
router.post(
  "/stock-movement/import",
  upload.single("file"),
  controller.importStockMovement,
);

// IMPORT — procurement modules (item lines upsert by document number).
router.post(
  "/purchase-request/import",
  upload.single("file"),
  controller.importPurchaseRequest,
);
router.post(
  "/purchase-order/import",
  upload.single("file"),
  controller.importPurchaseOrder,
);
router.post(
  "/good-receipt/import",
  upload.single("file"),
  controller.importGoodReceipt,
);
router.post(
  "/delivery-order/import",
  upload.single("file"),
  controller.importDeliveryOrder,
);

// IMPORT — finance modules (line-based upsert by entry_no; COA by code).
router.post(
  "/journal-entry/import",
  upload.single("file"),
  controller.importJournalEntry,
);
router.post(
  "/journal-write-off/import",
  upload.single("file"),
  controller.importJournalWriteOff,
);
router.post(
  "/account-receivable/import",
  upload.single("file"),
  controller.importAccountReceivable,
);
router.post(
  "/account-payable/import",
  upload.single("file"),
  controller.importAccountPayable,
);
router.post(
  "/chart-of-account/import",
  upload.single("file"),
  controller.importChartOfAccount,
);

// EXPORT — master, stock, & procurement.
router.get("/product/export", controller.exportProduct);
router.get("/product-category/export", controller.exportProductCategory);
router.get("/uom/export", controller.exportUom);
router.get("/warehouse/export", controller.exportWarehouse);
router.get("/supplier/export", controller.exportSupplier);
router.get("/stock-position/export", controller.exportStockPosition);
router.get("/stock-movement/export", controller.exportStockMovement);
router.get("/purchase-request/export", controller.exportPurchaseRequest);
router.get("/purchase-order/export", controller.exportPurchaseOrder);
router.get("/good-receipt/export", controller.exportGoodReceipt);
router.get("/delivery-order/export", controller.exportDeliveryOrder);

// EXPORT — finance.
router.get("/journal-entry/export", controller.exportJournalEntry);
router.get("/journal-write-off/export", controller.exportJournalWriteOff);
router.get("/account-receivable/export", controller.exportAccountReceivable);
router.get("/account-payable/export", controller.exportAccountPayable);
router.get("/chart-of-account/export", controller.exportChartOfAccount);

module.exports = router;
