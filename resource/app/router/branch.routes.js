const controller = require("../controller/Branch.controller");
const uploadFilesMiddleware = require("../../middleware/multer");

const router = require("express").Router();

router.get("/", controller.index);
router.get("/:id", controller.show);
router.post("/", controller.create);
router.post("/upload", uploadFilesMiddleware("branch"), controller.uploadImage);
router.put("/:id", controller.update);
router.delete("/:id", controller.delete);

module.exports = router;
