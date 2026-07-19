const controller = require("../controller/ChartOfAccount.controller");

const router = require("express").Router();

router.get("/", controller.index);
router.post("/", controller.create);
router.put("/:id", controller.update);
router.delete("/:id", controller.delete);

module.exports = router;
