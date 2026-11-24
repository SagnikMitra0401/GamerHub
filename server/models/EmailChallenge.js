const mongoose = require('mongoose');

/**
 * Short-lived numeric email challenge.
 *
 * One row per (user, purpose) at a time. Only an HMAC of the code is stored, so
 * a database dump cannot be replayed against the API and an 8-digit space is not
 * brute-forceable offline without the server pepper. The TTL index is a safety
 * net; every consume path also checks `expiresAt` because TTL sweeps are lazy.
 */
const EmailChallengeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    purpose: {
      type: String,
      enum: ['verify_email', 'verify_recovery', 'recover_account'],
      required: true
    },
    // The address the code was sent to. Recovery setup needs it because the
    // pending address is deliberately not written to the user document.
    target: {
      type: String,
      default: '',
      maxlength: 254
    },
    codeHash: {
      type: String,
      required: true
    },
    attempts: {
      type: Number,
      default: 0
    },
    expiresAt: {
      type: Date,
      required: true
    },
    consumedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

EmailChallengeSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'email_challenge_ttl' }
);
// One live challenge per user and purpose, even if two tabs request a code at
// the same instant. Consumed rows leave the partial index.
EmailChallengeSchema.index(
  { userId: 1, purpose: 1 },
  {
    unique: true,
    partialFilterExpression: { consumedAt: null },
    name: 'email_challenge_live'
  }
);

module.exports = mongoose.model('EmailChallenge', EmailChallengeSchema);
