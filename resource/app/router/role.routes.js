const router = require("express").Router();
const controller = require("../controller/Role.controller");

router.get("/", controller.getAllRole);
router.post("/", controller.createRole);
router.put("/:id", controller.updateRole);
router.delete("/:id", controller.deleteRole);

module.exports = router;
