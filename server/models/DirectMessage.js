const mongoose = require('mongoose');

/**
 * A message inside a 1:1 thread. Text-only in Phase A: no media, no links
 * before acceptance. Account erasure leaves a tombstone (`[deleted]`) so the
 * other participant's history does not silently change shape.
 */
const DirectMessageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true
    },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    text: {
      type: String,
      required: true,
      maxlength: 2000
    },
    kind: {
      type: String,
      enum: ['text', 'system'],
      default: 'text'
    },
    reportedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
);

DirectMessageSchema.index({ conversationId: 1, createdAt: -1 });
DirectMessageSchema.index({ authorId: 1, createdAt: -1 });

module.exports = mongoose.model('DirectMessage', DirectMessageSchema);
