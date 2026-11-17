const mongoose = require('mongoose');

/**
 * One-shot email tokens.
 *
 * Only a SHA-256 hash is stored: a database read must never yield a working
 * verification or reset link. The TTL index is a safety net for abandoned
 * tokens; every consume path also checks `expiresAt` explicitly because TTL
 * deletion runs on a background interval and is not immediate.
 */
const AccountTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    purpose: {
      type: String,
      enum: ['verify_email', 'reset_password'],
      required: true
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true
    },
    expiresAt: {
      type: Date,
      required: true
    },
    usedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

AccountTokenSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'account_token_ttl' }
);
AccountTokenSchema.index({ userId: 1, purpose: 1, usedAt: 1 });
// A user has at most one live token per purpose, even if two tabs request a
// resend at the same instant. Used tokens leave the partial index.
AccountTokenSchema.index(
  { userId: 1, purpose: 1 },
  {
    unique: true,
    partialFilterExpression: { usedAt: null },
    name: 'account_token_live'
  }
);

module.exports = mongoose.model('AccountToken', AccountTokenSchema);
