const mongoose = require("mongoose");

const sharedWithSchema = new mongoose.Schema(
  {
    userId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true 
    },
    permission: { 
      type: String, 
      enum: ["viewer", "editor"], 
      required: true 
    },
  },
  { _id: false }
);

const activityLogSchema = new mongoose.Schema(
  {
    action: { 
      type: String, 
      required: true, 
      trim: true, 
      maxlength: 60 
    },
    userId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true 
    },
    timestamp: { 
      type: Date, 
      required: true 
    },
    meta: { 
      type: mongoose.Schema.Types.Mixed, 
      default: null 
    },
  },
  { _id: false }
);

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
    sharedWith: { type: [sharedWithSchema], default: [] },
    activityLog: { type: [activityLogSchema], default: [] },
    lastEditedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    lastEditedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

noteSchema.index({ "sharedWith.userId": 1 });

module.exports = mongoose.model("Note", noteSchema);
