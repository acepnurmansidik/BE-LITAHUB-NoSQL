const router = require("express").Router();
const controller = require("../controller/User.controller");

router.get("/", controller.getAllUser);
router.get("/iam", controller.getUserPermissionAccess);
router.post("/", controller.createUser);
router.put("/:id", controller.updateUser);
router.delete("/:id", controller.deleteUser);

module.exports = router;
