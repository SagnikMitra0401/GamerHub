const mongoose = require('mongoose');

/**
 * Platform-level audit trail for DM report resolution. AuditLog is scoped to a
 * community and cannot represent a platform-wide DM decision without inventing
 * a community id, so this small collection keeps the decision and its note.
 */
const DmModerationAuditSchema = new mongoose.Schema(
  {
    reportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DmReport',
      required: true,
      index: true
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: {
      type: String,
      enum: ['reviewed', 'actioned', 'dismissed'],
      required: true
    },
    note: { type: String, default: '', maxlength: 500 }
  },
  { timestamps: true }
);

DmModerationAuditSchema.index({ reportId: 1, createdAt: -1 });

module.exports = mongoose.model('DmModerationAudit', DmModerationAuditSchema);
