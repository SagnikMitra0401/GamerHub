const mongoose = require('mongoose');

/**
 * A disclosed business mode for an existing account. One login, one handle and
 * one follower graph: this document only carries the public business details
 * and the verification state. It never grants permissions by itself.
 */
const BusinessProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    displayName: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    category: {
      type: String,
      enum: ['creator', 'esports', 'studio', 'brand', 'other'],
      default: 'creator',
      index: true,
    },
    description: { type: String, default: '', trim: true, maxlength: 600 },
    website: { type: String, default: '', trim: true, maxlength: 200 },
    supportEmail: { type: String, default: '', trim: true, maxlength: 120 },

    // Verification correspondence. `supportEmail` is public; these fields are
    // shown only to the owner and to review staff.
    contactEmail: { type: String, default: '', trim: true, maxlength: 120 },
    contactMethod: {
      type: String,
      enum: ['email', 'phone', 'other'],
      default: 'email',
    },
    contactDetail: { type: String, default: '', trim: true, maxlength: 120 },
    proofType: {
      type: String,
      enum: ['registration', 'tax', 'domain_email', 'official_profile', 'other'],
      default: 'other',
    },
    proofUrl: { type: String, default: '', trim: true, maxlength: 300 },
    proofNote: { type: String, default: '', trim: true, maxlength: 600 },
    reviewContactedAt: { type: Date, default: null },
    // The owner's answer to that contact. Stored so a reviewer reads it before
    // deciding, instead of relying on an off-platform email reply.
    reviewRespondedAt: { type: Date, default: null },
    reviewResponseNote: { type: String, default: '', maxlength: 1000 },
    // When the current application was decided (verified, rejected or
    // demoted). The evidence retention window runs from this instant.
    reviewDecidedAt: { type: Date, default: null },
    // Set by the retention worker after the evidence fields are cleared, so
    // the owner and reviewers can see that nothing was lost by accident.
    evidencePurgedAt: { type: Date, default: null },
    demotedAt: { type: Date, default: null },
    demotionReason: { type: String, default: '', maxlength: 500 },

    timezone: { type: String, default: '', trim: true, maxlength: 60 },
    responseExpectation: { type: String, default: '', trim: true, maxlength: 80 },
    links: {
      type: [String],
      default: [],
      set: (values) =>
        Array.isArray(values)
          ? values
              .map((value) => String(value).trim().slice(0, 200))
              .filter(Boolean)
              .slice(0, 5)
          : [],
    },

    verificationStatus: {
      type: String,
      enum: ['none', 'pending', 'verified', 'rejected', 'expired'],
      default: 'none',
      index: true,
    },
    verificationMethod: {
      type: String,
      enum: ['dns', 'manual', null],
      default: null,
    },
    verificationDomain: { type: String, default: '', trim: true, maxlength: 120 },
    verificationToken: { type: String, default: '', maxlength: 80 },
    verificationRequestedAt: { type: Date, default: null },
    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Internal outreach health. A complaint-rate pause is deliberately silent
    // on the public profile; the business owner sees it in settings.
    complaints: { type: Number, default: 0, min: 0 },
    outreachPaused: { type: Boolean, default: false },
  },
  { timestamps: true },
);

BusinessProfileSchema.index({ verificationStatus: 1, createdAt: -1 });
BusinessProfileSchema.index({ reviewDecidedAt: 1 });

module.exports = mongoose.model('BusinessProfile', BusinessProfileSchema);
