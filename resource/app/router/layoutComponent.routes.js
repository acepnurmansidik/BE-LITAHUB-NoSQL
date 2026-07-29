const uploadFilesMiddleware = require("../../middleware/multer");
const controller = require("../controller/LayoutComponent.controller");

const router = require("express").Router();

router.get("/", controller.index);
router.get("/grouped", controller.grouped);
router.get("/:id", controller.show);
router.post("/", controller.create);
router.put("/:id", controller.update);
router.delete("/:id", controller.delete);
router.post(
  "/upload",
  uploadFilesMiddleware("component-layout"),
  controller.uploadImage,
);

module.exports = router;
