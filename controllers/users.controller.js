const User = require("../models/User");

function escapeRegExp(input) {
  return String(input || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function searchUsers(req, res) {
  const raw = String(req.query?.q || "").trim().toLowerCase();
  if (!raw || raw.length < 2) return res.json({ users: [] });
  const safe = escapeRegExp(raw);
  const regex = new RegExp("^" + safe, "i");
  const rows = await User.find({ email: regex })
    .select({ name: 1, email: 1 })
    .limit(10)
    .lean();
  const users = rows.map((u) => ({ id: String(u._id), name: u.name, email: u.email }));
  return res.json({ users });
}

async function getUserById(req, res) {
  const id = String(req.params?.id || "");
  if (!id || id.length < 10) return res.status(400).json({ message: "Invalid user id" });
  const u = await User.findById(id).select({ name: 1, email: 1 }).lean();
  if (!u) return res.status(404).json({ message: "User not found" });
  return res.json({ user: {
      id: String(u._id),
      name: u.name, 
      email: u.email 
    } 
  });
}

module.exports = { searchUsers, getUserById };
