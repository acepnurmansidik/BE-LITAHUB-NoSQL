const controller = require("../controller/Upload.controller");
const uploadFilesMiddleware = require("../../middleware/multer");

const router = require("express").Router();

// Upload multiple: field form-data "files", maksimal 10 file per request.
router.post(
  "/multiple",
  uploadFilesMiddleware("file_documents", { field: "files", maxCount: 10 }),
  controller.uploadMultiple,
);

// Upload single: field form-data "file", 1 file per request.
router.post(
  "/single",
  uploadFilesMiddleware("file_documents", { field: "file", maxCount: 1 }),
  controller.uploadSingle,
);

module.exports = router;
