const User = require('../models/User');

/**
 * Platform account-state helpers.
 *
 * A suspension may carry an end date. Rather than a background worker (which
 * this single-instance deployment does not need), the next request that sees
 * the expired date restores the previous state. `status` stays the field every
 * guard already reads, so nothing downstream had to learn a new concept.
 */
const SUSPENDED = 'suspended';

function suspensionExpired(user, now = new Date()) {
  if (!user || user.status !== SUSPENDED) return false;
  const until = user.moderation?.until;
  return Boolean(until) && new Date(until).getTime() <= now.getTime();
}

/** Restore an expired suspension in place. Returns the (possibly same) user. */
async function releaseExpiredSuspension(user, now = new Date()) {
  if (!suspensionExpired(user, now)) return user;

  const previous = user.moderation?.previousStatus || 'active';
  await User.updateOne(
    { _id: user._id, status: SUSPENDED },
    { $set: { status: previous, 'moderation.until': null, 'moderation.reason': '' } }
  );
  // The document is a hydrated model in the auth middleware and a plain object
  // in login; assigning works for both.
  user.status = previous;
  if (user.moderation) user.moderation.until = null;
  return user;
}

const STATUS_ACTIONS = Object.freeze({
  restrict: 'restricted',
  suspend: SUSPENDED,
  reinstate: 'active'
});

function moderationReason(value) {
  return String(value || '').trim().slice(0, 300);
}

module.exports = {
  SUSPENDED,
  STATUS_ACTIONS,
  suspensionExpired,
  releaseExpiredSuspension,
  moderationReason
};
