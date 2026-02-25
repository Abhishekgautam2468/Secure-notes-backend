const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    recipientUserId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true, 
      index: true 
    },
    actorUserId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", required: true 
    },
    noteId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "Note", required: true, index: true },
    type: { type: String, 
      enum: ["shared", "unshared", "permission_changed"], 
      required: true, 
      index: true 
    },
    permission: { 
      type: String, 
      enum: ["viewer", "editor"], 
      default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

notificationSchema.index({ recipientUserId: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);

