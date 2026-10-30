/**
 * Consent, blocking and account-state rules.
 *
 * Kept pure on purpose: every decision here is a function of documents passed
 * in, so the consent matrix can be unit-tested without a database and the
 * controllers stay thin.
 */

const INVITE_POLICIES = Object.freeze(['anyone', 'followers', 'none']);
const DM_POLICIES = Object.freeze(['anyone', 'mutual_follows', 'none']);
const ACCOUNT_STATUSES = Object.freeze(['active', 'restricted', 'suspended', 'deletion_pending', 'deleted']);

/** Accepts an ObjectId, a string or a document with `_id`. */
const idOf = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return String(value._id);
  return String(value);
};

/** Does `ids` contain `user`? Accepts documents or raw ids. */
const containsId = (ids, userId) => {
  const target = idOf(userId);
  if (!target || !Array.isArray(ids)) return false;
  return ids.some((entry) => idOf(entry) === target);
};

/**
 * Blocking is symmetric for delivery: if either side blocked the other, no
 * invitation (or DM) is delivered. Report the fact, never who blocked whom.
 */
function isBlockedBetween(a, b) {
  return containsId(a?.blockedUsers, idOf(b)) || containsId(b?.blockedUsers, idOf(a));
}

/**
 * May `inviter` invite `recipient` to a squad / server?
 *
 * @param {object} input
 * @param {'squad'|'community_server'} input.targetType
 * @param {object} input.recipient  recipient user document
 * @param {object} input.inviter    inviter user document
 * @param {boolean} input.inviterFollowsRecipient
 * @returns {{ok: boolean, reason?: string, code?: string}}
 */
function canInvite({ targetType, recipient, inviter, inviterFollowsRecipient = false }) {
  if (!recipient || !inviter) {
    return { ok: false, code: 'NOT_FOUND', reason: 'That player could not be found.' };
  }

  const inviterId = idOf(inviter);
  const recipientId = idOf(recipient);

  if (!inviterId || !recipientId) {
    return { ok: false, code: 'NOT_FOUND', reason: 'That player could not be found.' };
  }
  if (inviterId === recipientId) {
    return { ok: false, code: 'SELF_INVITE', reason: 'You are already in this squad.' };
  }
  // A deleted (or mid-deletion) account has withdrawn consent entirely.
  if (['deleted', 'deletion_pending', 'suspended'].includes(recipient.status)) {
    return { ok: false, code: 'UNAVAILABLE', reason: 'This player cannot be invited.' };
  }
  if (isBlockedBetween(inviter, recipient)) {
    // Deliberately generic: a blocked inviter must not learn they were blocked.
    return { ok: false, code: 'BLOCKED', reason: 'This player cannot be invited.' };
  }

  const setting = targetType === 'community_server'
    ? recipient.privacySettings?.allowServerInvites ?? 'anyone'
    : recipient.privacySettings?.allowSquadInvites ?? 'anyone';

  if (setting === 'none') {
    const noun = targetType === 'community_server' ? 'server' : 'squad';
    return {
      ok: false,
      code: 'PRIVACY',
      reason: `This player does not accept ${noun} invitations.`
    };
  }
  if (setting === 'followers' && !inviterFollowsRecipient) {
    return {
      ok: false,
      code: 'PRIVACY',
      reason: 'This player only accepts invitations from people they follow.'
    };
  }

  return { ok: true };
}

/**
 * Validate a privacy-settings patch.
 * Unknown keys are rejected rather than silently dropped, so a client typo
 * surfaces instead of appearing to work.
 */
function sanitizePrivacyPatch(body) {
  const errors = [];
  const value = {};
  const input = body && typeof body === 'object' ? body : {};

  const enumField = (key, allowed) => {
    if (input[key] === undefined) return;
    if (!allowed.includes(input[key])) {
      errors.push(`${key} must be one of: ${allowed.join(', ')}`);
      return;
    }
    value[key] = input[key];
  };

  const boolField = (key) => {
    if (input[key] === undefined) return;
    if (typeof input[key] !== 'boolean') {
      errors.push(`${key} must be true or false`);
      return;
    }
    value[key] = input[key];
  };

  enumField('allowSquadInvites', INVITE_POLICIES);
  enumField('allowServerInvites', INVITE_POLICIES);
  enumField('allowDirectMessages', DM_POLICIES);
  boolField('discoverableInSearch');
  boolField('showActivityStatus');

  if (errors.length) return { ok: false, errors };
  if (!Object.keys(value).length) {
    return { ok: false, errors: ['No updatable privacy fields provided'] };
  }
  return { ok: true, value };
}

/** Can this account still use authenticated endpoints? */
function accountGate(user) {
  if (!user) return { ok: false, status: 401, message: 'Not authenticated' };
  if (user.status === 'deleted') {
    return { ok: false, status: 401, message: 'This account no longer exists' };
  }
  if (user.status === 'suspended') {
    return { ok: false, status: 403, message: 'This account is suspended' };
  }
  return { ok: true };
}

/** Should this profile appear in a search performed by `viewerId`? */
function isDiscoverable(user, viewerId) {
  if (!user) return false;
  if (user.privacySettings?.discoverableInSearch === false) {
    return idOf(user) === idOf(viewerId);
  }
  return true;
}

const ERASURE_USERNAME_PREFIX = 'deleted_';
const ERASURE_EMAIL_DOMAIN = 'deleted.invalid';

/**
 * Irreversible erasure payload for an account past its grace period.
 * Login identities are dropped, so a later Google sign-in creates a fresh
 * account instead of reviving this one.
 */
function erasurePatch(user) {
  const id = idOf(user) || 'unknown';
  const suffix = id.slice(-8);
  return {
    $set: {
      username: `${ERASURE_USERNAME_PREFIX}${suffix}`.slice(0, 20),
      email: `${suffix}@${ERASURE_EMAIL_DOMAIN}`,
      // A random hash that matches no password; bcrypt rejects malformed hashes.
      passwordHash: `erased$${suffix}`,
      bio: '',
      status: 'deleted',
      sessionVersion: (Number(user?.sessionVersion) || 0) + 1,
      authIdentities: [],
      blockedUsers: [],
      mutedUsers: [],
      followers: [],
      following: [],
      savedPosts: [],
      'gamerPassport.customQuote': '',
      'gamerPassport.gameIds.riotId': '',
      'gamerPassport.gameIds.steamId': '',
      'gamerPassport.gameIds.psnTag': '',
      'gamerPassport.gameIds.xboxTag': '',
      'gamerPassport.gameIds.discordTag': '',
      'gamerPassport.activeGames': [],
      'gamerPassport.hardwareRigs': [],
      'preferences.favoriteGames': [],
      'preferences.favoriteGenres': [],
      'preferences.platforms': [],
      'presence.status': 'offline',
      'presence.activeGame': '',
      'privacySettings.discoverableInSearch': false
    }
  };
}

module.exports = {
  INVITE_POLICIES,
  DM_POLICIES,
  ACCOUNT_STATUSES,
  ERASURE_USERNAME_PREFIX,
  idOf,
  containsId,
  isBlockedBetween,
  canInvite,
  sanitizePrivacyPatch,
  accountGate,
  isDiscoverable,
  erasurePatch
};
