const mongoose = require("mongoose");

const noteSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    category: {
      type: String,
      default: "personal",
      index: true,
      lowercase: true,
      trim: true,
    },
    title: { type: String, default: "", trim: true, maxlength: 200 },
    body: { type: String, default: "", trim: true, maxlength: 10000 },
    isArchived: { type: Boolean, default: false, index: true },
    isTrashed: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Note", noteSchema);
