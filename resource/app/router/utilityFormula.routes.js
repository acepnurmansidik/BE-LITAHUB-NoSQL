const controller = require("../controller/UtilityFormula.controller");

const router = require("express").Router();

router.get("/", controller.index);
router.post("/", controller.create);
router.get("/:id", controller.show);
router.put("/:id", controller.update);
router.delete("/:id", controller.delete);

module.exports = router;
