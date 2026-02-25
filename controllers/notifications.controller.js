const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const Note = require("../models/Note");
const User = require("../models/User");

function normalizeObjectIdString(value) {
  if (!value) return null;
  try {
    return String(value);
  } catch {
    return null;
  }
}

async function listNotifications(req, res) {
  const me = req.user.id;
  const meObj = new mongoose.Types.ObjectId(me);
  const rows = await Notification.find({ recipientUserId: meObj })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const actorIds = Array.from(new Set(rows.map((r) => normalizeObjectIdString(r.actorUserId)).filter(Boolean)));
  const noteIds = Array.from(new Set(rows.map((r) => normalizeObjectIdString(r.noteId)).filter(Boolean)));

  const actors = await User.find({ _id: { $in: actorIds } })
  .select({ name: 1, email: 1 })
  .lean();

const notes = await Note.find({ _id: { $in: noteIds } })
  .select({ title: 1 })
  .lean();

  const actorById = Object.fromEntries(actors.map((u) => [String(u._id), u]));
  const noteById = Object.fromEntries(notes.map((n) => [String(n._id), n]));

  const notifications = rows.map((n) => {
    const actorId = normalizeObjectIdString(n.actorUserId);
    const actor = actorId ? actorById[actorId] : null;
    const noteId = normalizeObjectIdString(n.noteId);
    const note = noteId ? noteById[noteId] : null;
    const who = actor?.name || actor?.email || "Someone";
    const title = note?.title || "";
    const type = String(n.type || "");
    let message = "";
    if (type === "shared") message = `${who} shared a note with you • ${title}`;
    if (type === "unshared") message = `${who} unshared a note with you • ${title}`;
    if (type === "permission_changed") message = `${who} changed your permission to ${n.permission || ""} • ${title}`;
    return {
      id: String(n._id),
      type : type,
      noteId: noteId,
      noteTitle: title,
      actor: actorId ? { id: actorId, name: actor?.name || null, email: actor?.email || null } : null,
      permission: n.permission || null,
      readAt: n.readAt ? new Date(n.readAt).toISOString() : null,
      createdAt: n.createdAt ? new Date(n.createdAt).toISOString() : null,
      message : message,
    };
  });

  return res.json({ notifications });
}

async function deleteNotification(req, res) {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid notification id" });
  const meObj = new mongoose.Types.ObjectId(req.user.id);
  const deleted = await Notification.deleteOne({ _id: id, recipientUserId: meObj });
  if (!deleted?.deletedCount) return res.status(404).json({ message: "Notification not found" });
  return res.json({ ok: true });
}

async function clearNotifications(req, res) {
  const meObj = new mongoose.Types.ObjectId(req.user.id);
  await Notification.deleteMany({ recipientUserId: meObj });
  return res.json({ ok: true });
}

module.exports = { listNotifications, deleteNotification, clearNotifications };

