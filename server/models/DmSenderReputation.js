const mongoose = require('mongoose');

/**
 * Internal sender reputation. This document is never exposed by the API: the
 * recipient sees a filtered request or a normal one, not a score. Counters are
 * updated from the real conversation lifecycle so a repeated spammer eventually
 * loses the benefit of the doubt without a manual moderation step.
 */
const DmSenderReputationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true
    },
    coldRequests: { type: Number, default: 0, min: 0 },
    accepted: { type: Number, default: 0, min: 0 },
    declined: { type: Number, default: 0, min: 0 },
    expired: { type: Number, default: 0, min: 0 },
    reports: { type: Number, default: 0, min: 0 },
    blocks: { type: Number, default: 0, min: 0 },
    tier: {
      type: String,
      enum: ['standard', 'limited', 'restricted'],
      default: 'standard',
      index: true
    },
    lastRequestAt: { type: Date, default: null }
  },
  { timestamps: true }
);

DmSenderReputationSchema.index({ tier: 1, updatedAt: -1 });

module.exports = mongoose.model('DmSenderReputation', DmSenderReputationSchema);
