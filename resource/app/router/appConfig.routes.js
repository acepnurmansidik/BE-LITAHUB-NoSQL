const router = require("express").Router();
const AuthorizeUserLogin = require("../../middleware/authentification");
const controller = require("../controller/Root.controller");

router.get("/app-configs/latest", controller.getLatestVersion);
router.get("/app-configs/release-history", controller.getReleaseHistory);

router.use(AuthorizeUserLogin);
router.put("/app-configs", controller.updateVersion);

module.exports = router;
