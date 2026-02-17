const mongoose = require("mongoose");
const Note = require("../models/Note");
const Tag = require("../models/Tag");

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
  return res.json({ notes });
}

async function createNote(req, res) {
  const { title = "", body = "", category } = req.body || {};

  const normalizedCategory = normalizeTagKey(category) || "personal";

  const note = await Note.create({
    userId: req.user.id,
    title,
    body,
    category: normalizedCategory,
  });

  return res.status(201).json({ note });
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

  const note = await Note.findOneAndUpdate({ _id: id, userId: req.user.id }, update, { new: true }).lean();
  if (!note) return res.status(404).json({ message: "Note not found" });

  return res.json({ note });
}

async function setArchived(req, res) {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid note id" });

  const archived = parseBoolean(req.body?.archived);
  if (archived == null) return res.status(400).json({ message: "archived is required" });

  const update = { isArchived: archived };
  if (archived) update.isTrashed = false;

  const note = await Note.findOneAndUpdate({ _id: id, userId: req.user.id }, update, { new: true }).lean();
  if (!note) return res.status(404).json({ message: "Note not found" });

  return res.json({ note });
}

async function setTrashed(req, res) {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid note id" });

  const trashed = parseBoolean(req.body?.trashed);
  if (trashed == null) return res.status(400).json({ message: "trashed is required" });

  const update = { isTrashed: trashed };
  if (trashed) update.isArchived = false;

  const note = await Note.findOneAndUpdate({ _id: id, userId: req.user.id }, update, { new: true }).lean();
  if (!note) return res.status(404).json({ message: "Note not found" });

  return res.json({ note });
}

async function deleteNote(req, res) {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid note id" });

  const note = await Note.findOne({ _id: id, userId: req.user.id }).lean();
  if (!note) return res.status(404).json({ message: "Note not found" });
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
};
