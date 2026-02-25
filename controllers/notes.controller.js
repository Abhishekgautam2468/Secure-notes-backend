const mongoose = require("mongoose");
const Note = require("../models/Note");
const Tag = require("../models/Tag");
const User = require("../models/User");
const Notification = require("../models/Notification");

const RESERVED_CREATE_TAG_KEYS = new Set(["all", "personal", "projects", "business"]);
const NON_DELETABLE_TAG_KEYS = new Set(["all"]);
const BUILTIN_TAG_KEYS = new Set(["personal", "projects", "business"]);

function parseBoolean(value) {
  if (value === true || value === false) return value;
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return null;
}

function escapeRegExp(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTagKey(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  const key = raw
    .replace(/[^a-z0-9\s-_]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return key || null;
}

function normalizeTagInput(value) {
  const label = String(value || "").trim().slice(0, 40);
  const key = normalizeTagKey(label);
  if (!key) return null;
  return { key, label };
}

function defaultLabelFor(key) {
  const k = String(key || "").toLowerCase();
  if (k === "projects") return "Projects";
  if (k === "business") return "Business";
  if (k === "personal") return "Personal";
  if (k === "all") return "All";
  return String(key || "");
}

function normalizeObjectIdString(value) {
  if (!value) return null;
  try {
    return String(value);
  } catch {
    return null;
  }
}

function getRole(note, userId) {
  const uid = normalizeObjectIdString(userId);
  if (!uid || !note) return null;

  const ownerId = normalizeObjectIdString(note.userId);
  if (ownerId && ownerId === uid) return "owner";

  const shared = Array.isArray(note.sharedWith) ? note.sharedWith : [];
  for (const s of shared) {
    const sharedUserId = normalizeObjectIdString(s?.userId);
    if (!sharedUserId || sharedUserId !== uid) continue;
    const perm = String(s?.permission || "").toLowerCase();
    if (perm === "editor") return "editor";
    if (perm === "viewer") return "viewer";
  }

  return null;
}

function canView(note, userId) {
  const role = getRole(note, userId);
  return role === "owner" || role === "editor" || role === "viewer";
}

function canEdit(note, userId) {
  const role = getRole(note, userId);
  return role === "owner" || role === "editor";
}

function canDelete(note, userId) {
  return getRole(note, userId) === "owner";
}

function pushActivity(note, { action, userId, meta }) {
  if (!note) return;
  const entry = {
    action: String(action || "").trim(),
    userId: new mongoose.Types.ObjectId(userId),
    timestamp: new Date(),
    meta: meta ?? null,
  };
  note.activityLog = Array.isArray(note.activityLog) ? note.activityLog : [];
  note.activityLog.push(entry);
}

async function createNotification({ recipientUserId, actorUserId, noteId, type, permission }) {
  try {
    await Notification.create({
      recipientUserId: new mongoose.Types.ObjectId(recipientUserId),
      actorUserId: new mongoose.Types.ObjectId(actorUserId),
      noteId: new mongoose.Types.ObjectId(noteId),
      type,
      permission: permission || null,
      readAt: null,
    });
  } catch (err) {
    console.error("Failed to create notification:", err);
  }
}

async function listNotes(req, res) {
  const filter = { userId: req.user.id };

  const archivedParam = parseBoolean(req.query.archived);
  const trashedParam = parseBoolean(req.query.trashed);

  filter.isArchived = archivedParam == null ? false : archivedParam;
  filter.isTrashed = trashedParam == null ? false : trashedParam;

  const tagKey = normalizeTagKey(req.query.tag);
  if (tagKey && tagKey !== "all") {
    filter.category = tagKey;
  }

  const q = String(req.query.q || "").trim();
  if (q) {
    const safe = escapeRegExp(q);
    filter.$or = [{ title: { $regex: safe, $options: "i" } }, { body: { $regex: safe, $options: "i" } }];
  }

  const notes = await Note.find(filter).sort({ updatedAt: -1 }).lean();
  const shaped = notes.map((n) => shapeNoteForUser(n, req.user.id));
  return res.json({ notes: shaped });
}

async function createNote(req, res) {
  const { title = "", body = "", category } = req.body || {};

  const normalizedCategory = normalizeTagKey(category) || "personal";

  const note = await Note.create({
    userId: req.user.id,
    title,
    body,
    category: normalizedCategory,
    lastEditedBy: req.user.id,
    lastEditedAt: new Date(),
    activityLog: [
      {
        action: "created",
        userId: req.user.id,
        timestamp: new Date(),
        meta: null,
      },
    ],
  });

  return res.status(201).json({ note: shapeNoteForUser(note, req.user.id) });
}

async function updateNote(req, res) {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid note id" });

  const { title, body, category } = req.body || {};
  const update = {};
  if (typeof title === "string") update.title = title;
  if (typeof body === "string") update.body = body;

  if (category != null) {
    const normalizedCategory = normalizeTagKey(category);
    if (!normalizedCategory) return res.status(400).json({ message: "Invalid category" });
    update.category = normalizedCategory;
  }

  const note = await Note.findById(id);
  if (!note) return res.status(404).json({ message: "Note not found" });
  if (!canView(note, req.user.id)) {
    return res.status(404).json({ message: "Note not found" });}

  const role = getRole(note, req.user.id);
  if (update.category != null && role !== "owner") {
    return res.status(403).json({ message: "Only the owner can change category" });
  }

  const isEditingContent = typeof update.title === "string" || typeof update.body === "string";
  if (isEditingContent && !canEdit(note, req.user.id)) {
    return res.status(403).json({ message: "You do not have permission to edit this note" });
  }

  const titleChanged = typeof update.title === "string" && update.title !== note.title;
  const bodyChanged = typeof update.body === "string" && update.body !== note.body;

  if (typeof update.title === "string") {
    note.title = update.title;
  }
  if (typeof update.body === "string") {
    note.body = update.body;
  }
  if (update.category != null) {
    note.category = update.category;
  }

  if (titleChanged || bodyChanged) {
    note.lastEditedBy = req.user.id;
    note.lastEditedAt = new Date();
    pushActivity(note, {
      action: "edited",
      userId: req.user.id,
      meta: {
        fields: [
          titleChanged ? "title" : null, 
          bodyChanged ? "body" : null
        ].filter(Boolean),
      },
    });
  }

  await note.save();

  return res.json({ note: shapeNoteForUser(note, req.user.id) });
}

async function setArchived(req, res) {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid note id" });

  const archived = parseBoolean(req.body?.archived);
  if (archived == null) return res.status(400).json({ message: "archived is required" });

  const note = await Note.findById(id);
  if (!note) return res.status(404).json({ message: "Note not found" });
  if (!canView(note, req.user.id)) return res.status(404).json({ message: "Note not found" });
  if (!canDelete(note, req.user.id)) return res.status(403).json({ message: "Only the owner can archive notes" });

  note.isArchived = archived;
  if (archived) note.isTrashed = false;
  await note.save();

  return res.json({ note: shapeNoteForUser(note, req.user.id) });
}

async function setTrashed(req, res) {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid note id" });

  const trashed = parseBoolean(req.body?.trashed);
  if (trashed == null) return res.status(400).json({ message: "trashed is required" });

  const note = await Note.findById(id);
  if (!note) return res.status(404).json({ message: "Note not found" });
  if (!canView(note, req.user.id)) return res.status(404).json({ message: "Note not found" });
  if (!canDelete(note, req.user.id)) return res.status(403).json({ message: "Only the owner can trash notes" });

  note.isTrashed = trashed;
  if (trashed) note.isArchived = false;
  await note.save();

  return res.json({ note: shapeNoteForUser(note, req.user.id) });
}

async function deleteNote(req, res) {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid note id" });

  const note = await Note.findById(id).lean();
  if (!note) return res.status(404).json({ message: "Note not found" });
  if (!canView(note, req.user.id)) return res.status(404).json({ message: "Note not found" });
  if (!canDelete(note, req.user.id)) return res.status(403).json({ message: "Only the owner can delete notes" });
  if (!note.isTrashed) return res.status(400).json({ message: "Only trashed notes can be deleted" });

  await Note.deleteOne({ _id: id, userId: req.user.id });
  return res.json({ ok: true });
}

async function listTags(req, res) {
  const userObjectId = new mongoose.Types.ObjectId(req.user.id);

  await Tag.bulkWrite(
    [
      { updateOne: { filter: { userId: userObjectId, key: "personal" }, update: { $setOnInsert: { label: "Personal" } }, upsert: true } },
      { updateOne: { filter: { userId: userObjectId, key: "projects" }, update: { $setOnInsert: { label: "Projects" } }, upsert: true } },
      { updateOne: { filter: { userId: userObjectId, key: "business" }, update: { $setOnInsert: { label: "Business" } }, upsert: true } },
    ],
    { ordered: false }
  );

  const [tagDocs, rows] = await Promise.all([
    Tag.find({ userId: userObjectId }).sort({ createdAt: 1 }).lean(),
    Note.aggregate([
      { $match: { userId: userObjectId, isTrashed: false } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]),
  ]);

  const counts = Object.fromEntries(rows.map((r) => [String(r._id || "").toLowerCase(), r.count]));
  const docByKey = new Map(tagDocs.map((t) => [String(t.key || "").toLowerCase(), t]));

  for (const key of Object.keys(counts)) {
    if (!key) continue;
    if (key === "all") continue;
    if (docByKey.has(key)) continue;
    tagDocs.push({ key, label: defaultLabelFor(key) });
    docByKey.set(key, { key, label: defaultLabelFor(key) });
  }

  const total = Object.values(counts).reduce((sum, n) => sum + (Number(n) || 0), 0);
  const tags = [
    { key: "all", label: "All", count: total },
    ...tagDocs
      .filter((t) => t?.key && String(t.key).toLowerCase() !== "all")
      .map((t) => {
        const key = String(t.key).toLowerCase();
        return { key, label: t?.label || defaultLabelFor(key), count: counts[key] || 0 };
      }),
  ];

  return res.json({ tags });
}

async function createTag(req, res) {
  const input = normalizeTagInput(req.body?.name || req.body?.tagName || req.body?.label);
  if (!input) return res.status(400).json({ message: "Tag name is required" });
  if (RESERVED_CREATE_TAG_KEYS.has(input.key)) return res.status(400).json({ message: "This tag name is reserved" });

  const userObjectId = new mongoose.Types.ObjectId(req.user.id);
  const existing = await Tag.findOne({ userId: userObjectId, key: input.key }).lean();
  if (existing) return res.status(409).json({ message: "Tag already exists" });

  const tag = await Tag.create({ userId: userObjectId, key: input.key, label: input.label });
  return res.status(201).json({ tag: { key: tag.key, label: tag.label } });
}

async function deleteTag(req, res) {
  const key = normalizeTagKey(req.params.key);
  if (!key) return res.status(400).json({ message: "Invalid tag key" });
  if (NON_DELETABLE_TAG_KEYS.has(key)) return res.status(403).json({ message: "This tag cannot be deleted" });

  const userObjectId = new mongoose.Types.ObjectId(req.user.id);
  const isBuiltin = BUILTIN_TAG_KEYS.has(key);
  const tag = await Tag.findOne({ userId: userObjectId, key }).lean();
  if (!isBuiltin && !tag) return res.status(404).json({ message: "Tag not found" });

  const notesDeleteRes = await Note.deleteMany({ userId: userObjectId, category: key });
  if (!isBuiltin) await Tag.deleteOne({ userId: userObjectId, key });

  return res.json({ ok: true, deletedNotes: notesDeleteRes?.deletedCount || 0 });
}

function normalizeEmailForLookup(email) {
  return String(email || "").trim().toLowerCase();
}

function validatePermission(input) {
  const p = String(input || "").toLowerCase();
  if (p === "viewer" || p === "editor") return p;
  return null;
}

function shapeNoteForUser(noteDoc, userId) {
  if (!noteDoc) return null;
  const obj = typeof noteDoc.toObject === "function" ? noteDoc.toObject() : { ...noteDoc };
  const role = getRole(obj, userId);
  const isShared = Array.isArray(obj.sharedWith) && obj.sharedWith.length > 0;
  const shaped = { ...obj, access: { role: role || null }, isShared: Boolean(isShared) };
  if (role !== "owner") {
    delete shaped.sharedWith;
  }
  return shaped;
}

async function shareNote(req, res) {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid note id" });

  const email = normalizeEmailForLookup(req.body?.email);
  const permission = validatePermission(req.body?.permission);
  if (!email) return res.status(400).json({ message: "Valid email is required" });
  if (!permission) return res.status(400).json({ message: "permission must be 'viewer' or 'editor'" });

  const note = await Note.findById(id);
  if (!note) return res.status(404).json({ message: "Note not found" });
  if (!canDelete(note, req.user.id)) return res.status(403).json({ message: "Only the owner can share notes" });

  const user = await User.findOne({ email }).lean();
  if (!user) return res.status(404).json({ message: "User not found" });

  const ownerId = String(note.userId);
  const targetId = String(user._id);
  if (ownerId === targetId) return res.status(400).json({ message: "Cannot share a note with yourself" });

  note.sharedWith = Array.isArray(note.sharedWith) ? note.sharedWith : [];
  const existing = note.sharedWith.find((s) => String(s.userId) === targetId);
  if (existing) {
    if (existing.permission === permission) {
      return res.json({ note: shapeNoteForUser(note, req.user.id) });
    }
    existing.permission = permission;
    pushActivity(note, {
      action: "permission_changed",
      userId: req.user.id,
      meta: { targetUserId: targetId, permission }
    });
    await createNotification({
      recipientUserId: targetId,
      actorUserId: req.user.id,
      noteId: id,
      type: "permission_changed",
      permission,
    });
  } else {
    note.sharedWith.push({
      userId: new mongoose.Types.ObjectId(targetId),
      permission
    });
    pushActivity(note, {
      action: "shared",
      userId: req.user.id,
      meta: { targetUserId: targetId, permission }
    });
    await createNotification({
      recipientUserId: targetId,
      actorUserId: req.user.id,
      noteId: id,
      type: "shared",
      permission,
    });
  }

  await note.save();
  return res.json({ note: shapeNoteForUser(note, req.user.id) });
}

async function updateSharePermission(req, res) {
  const id = req.params.id;
  const targetUserId = req.params.userId;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid note id" });
  if (!mongoose.isValidObjectId(targetUserId)) return res.status(400).json({ message: "Invalid user id" });

  const permission = validatePermission(req.body?.permission);
  if (!permission) return res.status(400).json({ message: "permission must be 'viewer' or 'editor'" });

  const note = await Note.findById(id);
  if (!note) return res.status(404).json({ message: "Note not found" });
  if (!canDelete(note, req.user.id)) return res.status(403).json({ message: "Only the owner can change permission" });

  note.sharedWith = Array.isArray(note.sharedWith) ? note.sharedWith : [];
  const existing = note.sharedWith.find((s) => String(s.userId) === String(targetUserId));
  if (!existing) return res.status(404).json({ message: "Share not found" });
  if (existing.permission !== permission) {
    existing.permission = permission;
    pushActivity(note, {
      action: "permission_changed",
      userId: req.user.id,
      meta: { targetUserId: String(targetUserId), permission }
    });
    await createNotification({
      recipientUserId: String(targetUserId),
      actorUserId: req.user.id,
      noteId: id,
      type: "permission_changed",
      permission,
    });
  }
  await note.save();
  return res.json({ note: shapeNoteForUser(note, req.user.id) });
}

async function revokeShare(req, res) {
  const id = req.params.id;
  const targetUserId = req.params.userId;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid note id" });
  if (!mongoose.isValidObjectId(targetUserId)) return res.status(400).json({ message: "Invalid user id" });

  const note = await Note.findById(id);
  if (!note) return res.status(404).json({ message: "Note not found" });
  if (!canDelete(note, req.user.id)) return res.status(403).json({ message: "Only the owner can revoke access" });

  note.sharedWith = Array.isArray(note.sharedWith) ? note.sharedWith : [];
  const before = note.sharedWith.length;
  note.sharedWith = note.sharedWith.filter((s) => String(s.userId) !== String(targetUserId));
  if (note.sharedWith.length === before) return res.status(404).json({ message: "Share not found" });

  pushActivity(note, {
    action: "unshared",
    userId: req.user.id,
    meta: { targetUserId: String(targetUserId) }
  });
  await createNotification({
    recipientUserId: String(targetUserId),
    actorUserId: req.user.id,
    noteId: id,
    type: "unshared",
    permission: null,
  });
  await note.save();
  return res.json({ note: shapeNoteForUser(note, req.user.id) });
}

async function listSharedWithMe(req, res) {
  const me = new mongoose.Types.ObjectId(req.user.id);
  const notes = await Note.find({
    "sharedWith.userId": me,
    userId: { $ne: me },
    isTrashed: false,
    isArchived: false,
  })
    .sort({ updatedAt: -1 })
    .lean();
  const shaped = notes.map((n) => shapeNoteForUser(n, req.user.id));
  return res.json({ notes: shaped });
}

module.exports = {
  listNotes,
  createNote,
  updateNote,
  setArchived,
  setTrashed,
  deleteNote,
  listTags,
  createTag,
  deleteTag,
  shareNote,
  updateSharePermission,
  revokeShare,
  listSharedWithMe,
};
