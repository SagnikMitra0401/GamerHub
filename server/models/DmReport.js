const mongoose = require('mongoose');

/**
 * A report from one participant about a thread. One open report per reporter
 * per conversation; re-reporting updates the note instead of flooding a queue.
 * Reports survive message edits on purpose: they are moderation evidence.
 */
const DmReportSchema = new mongoose.Schema(
  {
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true
    },
    reportedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    messageIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'DirectMessage' }],
    reason: {
      type: String,
      enum: ['spam', 'harassment', 'hate_speech', 'sexual_content', 'other'],
      required: true
    },
    note: { type: String, default: '', maxlength: 500 },
    status: {
      type: String,
      enum: ['open', 'reviewed', 'actioned', 'dismissed'],
      default: 'open',
      index: true
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: '', maxlength: 500 }
  },
  { timestamps: true }
);

DmReportSchema.index({ reporterId: 1, conversationId: 1 }, { unique: true });
DmReportSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('DmReport', DmReportSchema);
