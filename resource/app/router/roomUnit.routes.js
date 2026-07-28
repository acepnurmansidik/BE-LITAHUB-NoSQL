const controller = require("../controller/RoomUnit.controller");
const uploadFilesMiddleware = require("../../middleware/multer");

const router = require("express").Router();

router.get("/", controller.index);
router.get("/:id", controller.show);
router.post("/", controller.create);
router.post(
  "/upload",
  uploadFilesMiddleware("room-unit"),
  controller.uploadImage,
);
router.put("/:id", controller.update);
router.delete("/:id", controller.delete);

module.exports = router;
