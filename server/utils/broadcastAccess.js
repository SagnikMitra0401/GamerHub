/**
 * Broadcast channel rules.
 *
 * Publishing is owner-or-platform-staff; reading is public-channel-or-
 * subscriber. Kept pure so the matrix can be unit-tested without a database.
 */

const idOf = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value._id) return String(value._id);
  return String(value);
};

const isStaff = (user) => ['admin', 'moderator'].includes(user?.role);

function canPublish(channel, user) {
  if (!channel || !user) return false;
  if (idOf(channel.ownerId) === idOf(user)) return true;
  return isStaff(user);
}

/**
 * @param {object} input
 * @param {object} input.channel
 * @param {object|null} input.user
 * @param {object|null} input.subscription
 */
function canReadChannel({ channel, user, subscription }) {
  if (!channel) return false;
  if (channel.isPublic) return true;
  if (!user) return false;
  if (idOf(channel.ownerId) === idOf(user)) return true;
  if (isStaff(user)) return true;
  return Boolean(subscription);
}

/** Lowercase slug with single hyphens, bounded to the schema's max length. */
function slugifyBroadcastName(name) {
  const base = String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'channel';
}

/** Append a numeric suffix until the slug is free. */
function uniqueSlug(base, taken) {
  const used = new Set((taken || []).map((slug) => String(slug).toLowerCase()));
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}-${suffix}`.slice(0, 60);
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`.slice(0, 60);
}

module.exports = { canPublish, canReadChannel, slugifyBroadcastName, uniqueSlug, isStaff, idOf };
