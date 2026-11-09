const mongoose = require('mongoose');

/** Audit trail for business verification decisions. */
const BusinessVerificationAuditSchema = new mongoose.Schema(
  {
    businessProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BusinessProfile',
      required: true,
      index: true
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    status: { type: String, enum: ['verified', 'rejected'], required: true },
    note: { type: String, default: '', maxlength: 500 }
  },
  { timestamps: true }
);

BusinessVerificationAuditSchema.index({ businessProfileId: 1, createdAt: -1 });

module.exports = mongoose.model('BusinessVerificationAudit', BusinessVerificationAuditSchema);
