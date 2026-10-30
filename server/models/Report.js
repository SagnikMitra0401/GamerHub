const mongoose = require('mongoose');

const REPORT_REASONS = ['spam', 'harassment', 'hate_speech', 'nsfw', 'other'];
const REPORT_TARGETS = ['message', 'forumPost', 'member'];

const ReportSchema = new mongoose.Schema({
  communityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Community', required: true, index: true },
  reporterId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  targetType: { type: String, enum: REPORT_TARGETS, required: true },
  targetId:   { type: mongoose.Schema.Types.ObjectId, required: true },

  reason: { type: String, enum: REPORT_REASONS, required: true },
  note:   { type: String, default: '', maxlength: 300 },

  status: { type: String, enum: ['open', 'reviewed', 'dismissed'], default: 'open', index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  reviewNote: { type: String, default: '', maxlength: 300 }
}, { timestamps: true });

ReportSchema.index({ communityId: 1, status: 1, createdAt: -1 });
// One report per reporter per target: re-reporting is a no-op, not a new row.
ReportSchema.index({ reporterId: 1, targetId: 1 }, { unique: true });

module.exports = mongoose.model('Report', ReportSchema);
module.exports.REPORT_REASONS = REPORT_REASONS;
module.exports.REPORT_TARGETS = REPORT_TARGETS;
