/**
 * Username rules.
 *
 * The schema enforces the same shape, but the schema cannot explain itself and
 * the unique index is case-sensitive: `Alice` and `alice` would coexist. These
 * helpers are the single place that decides what a valid, unused handle is, and
 * they are pure so the rules can be unit-tested without a database.
 */

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const USERNAME_MIN = 3;
const USERNAME_MAX = 20;

// Names that would let an account impersonate the platform or a staff surface.
const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'moderator',
  'mod',
  'system',
  'support',
  'staff',
  'official',
  'gamerhub',
  'gaminghub',
  'settings',
  'api',
  'root'
]);

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {unknown} input
 * @returns {{ok: true, value: string} | {ok: false, reason: string}}
 */
function normalizeUsername(input) {
  if (typeof input !== 'string') {
    return { ok: false, reason: 'Username must be text.' };
  }

  const value = input.trim();
  if (!value) {
    return { ok: false, reason: 'Enter a username.' };
  }
  if (value.length < USERNAME_MIN || value.length > USERNAME_MAX) {
    return {
      ok: false,
      reason: `Usernames are ${USERNAME_MIN} to ${USERNAME_MAX} characters long.`
    };
  }
  if (!USERNAME_PATTERN.test(value)) {
    return { ok: false, reason: 'Usernames use letters, numbers and underscores only.' };
  }
  if (RESERVED_USERNAMES.has(value.toLowerCase())) {
    return { ok: false, reason: 'That username is reserved.' };
  }

  return { ok: true, value };
}

/**
 * Mongo filter for an exact, case-insensitive match.
 * `exceptId` lets a change endpoint ignore the caller's own current document.
 */
function usernameFilter(value, exceptId = null) {
  const filter = { username: { $regex: `^${escapeRegex(value)}$`, $options: 'i' } };
  if (exceptId) filter._id = { $ne: exceptId };
  return filter;
}

module.exports = {
  USERNAME_PATTERN,
  USERNAME_MIN,
  USERNAME_MAX,
  RESERVED_USERNAMES,
  normalizeUsername,
  usernameFilter
};
