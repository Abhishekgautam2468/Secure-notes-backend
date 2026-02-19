const express = require("express");
const {
  register,
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  me,
  updateProfile,
  changePassword,
  deleteAccount
} = require("../controllers/auth.controller");
const { authRateLimiter } = require("../middlewares/rateLimit");
const { requireAuth } = require("../middlewares/auth");

const router = express.Router();

router.post("/register", authRateLimiter, register);
router.post("/login", authRateLimiter, login);
router.post("/refresh", authRateLimiter, refresh);
router.post("/logout", logout);
router.post("/forgot-password", authRateLimiter, forgotPassword);
router.post("/reset-password", authRateLimiter, resetPassword);
router.get("/me", requireAuth, me);
router.patch("/me", requireAuth, updateProfile);
router.post("/change-password", requireAuth, changePassword);
router.delete("/me", requireAuth, deleteAccount);

module.exports = router;
