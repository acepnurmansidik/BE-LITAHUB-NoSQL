const express = require("express");
const controller = require("../auth/controller");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 100, // Maksimal 100 request per IP per 15 menit
  message: "Too many requests from this IP, please try again later",
});

/**
 * @route GET /users
 * @group Users - Operations about users
 * @tag Users
 * @returns {Array.<User>} 200 - An array of users
 * @returns {Error} 500 - Internal server error
 */
router.post("/sign-up", limiter, controller.Register);
router.post("/sign-in", limiter, controller.Login);
router.put("/forgot", controller.recoveryPassword);

module.exports = router;
