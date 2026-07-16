const router = require("express").Router();
const AuthorizeUserLogin = require("../../middleware/authentification");
const controller = require("../controller/AppConfig.controller");

router.get("/latest", controller.getLatestVersion);
router.get("/release-history", controller.getReleaseHistory);

router.use(AuthorizeUserLogin);
router.put("/", controller.updateVersion);
router.post("/", controller.createVersion);

module.exports = router;
