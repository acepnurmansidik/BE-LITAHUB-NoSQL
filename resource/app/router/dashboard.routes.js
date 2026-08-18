const controller = require("../controller/Dashboard.controller");
const router = require("express").Router();

// Satu endpoint = satu function per modul. Frontend hanya hit endpoint modul
// yang sedang ditampilkan (tab aktif).
router.get("/procurement", controller.procurement);
router.get("/finance", controller.finance);
router.get("/inventory", controller.inventory);

module.exports = router;
