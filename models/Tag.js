const mongoose = require("mongoose");

const tagSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    key: { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true, maxlength: 40 },
  },
  { timestamps: true }
);

tagSchema.index({ userId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("Tag", tagSchema);

