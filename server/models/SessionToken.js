const mongoose = require('mongoose');

/**
 * One row per signed-in browser.
 *
 * The access token is short-lived and lives only in a cookie; the refresh token
 * is what keeps a person signed in for a month. Storing its hash instead of the
 * token means a database dump cannot be replayed as a session, and marking a
 * row `replaced` on every use is what turns a copied token into a refusal: the
 * browser that owned it has already moved on, so the copy must not work.
 *
 * `expiresAt` carries a TTL index, so an abandoned session removes itself. A
 * rotated row is kept for a further week as evidence, which is long enough to
 * refuse a replay but short enough that an active account does not accumulate a
 * row per refresh forever.
 */
const SessionTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tokenHash: { type: String, required: true, unique: true },
    // The account's session version when this row was issued. A bump ("sign out
    // everywhere", a password change) retires the row without a write per row.
    sessionVersion: { type: Number, default: 0 },
    replaced: { type: Boolean, default: false },
    lastUsedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    revokedAt: { type: Date, default: null },
    // Not a fingerprint: a short label so a person can see their own sessions.
    userAgent: { type: String, default: '', trim: true, maxlength: 200 },
  },
  { timestamps: true },
);

SessionTokenSchema.index({ userId: 1, revokedAt: 1 });

module.exports = mongoose.model('SessionToken', SessionTokenSchema);
