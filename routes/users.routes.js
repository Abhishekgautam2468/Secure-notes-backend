const express = require("express");
const { searchUsers, getUserById } = require("../controllers/users.controller");
const { requireAuth } = require("../middlewares/auth");

const router = express.Router();

router.get("/search", requireAuth, searchUsers);
router.get("/:id", requireAuth, getUserById);

module.exports = router;
