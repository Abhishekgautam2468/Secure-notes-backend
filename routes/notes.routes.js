const express = require("express");
const {
  listNotes,
  createNote,
  updateNote,
  setArchived,
  setTrashed,
  deleteNote,
  listTags,
  createTag,
  deleteTag,
} = require("../controllers/notes.controller");
const { requireAuth } = require("../middlewares/auth");

const router = express.Router();

router.get("/", requireAuth, listNotes);
router.post("/", requireAuth, createNote);
router.get("/tags", requireAuth, listTags);
router.post("/tags", requireAuth, createTag);
router.delete("/tags/:key", requireAuth, deleteTag);
router.patch("/:id", requireAuth, updateNote);
router.post("/:id/archive", requireAuth, setArchived);
router.post("/:id/trash", requireAuth, setTrashed);
router.delete("/:id", requireAuth, deleteNote);

module.exports = router;
