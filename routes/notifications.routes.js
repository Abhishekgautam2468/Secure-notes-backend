const express = require("express");
const {
  listNotifications,
  deleteNotification,
  clearNotifications
} = require("../controllers/notifications.controller");
const { requireAuth } = require("../middlewares/auth");

const router = express.Router();

router.get("/", requireAuth, listNotifications);
router.delete("/:id", requireAuth, deleteNotification);
router.delete("/", requireAuth, clearNotifications);

module.exports = router;

