/**
 * Temporary squad-chat lifecycle rules.
 *
 * Pure functions so the expiry/refresh matrix is unit-tested without a
 * database, and so the REST controller, the socket handler and the retention
 * worker all agree on the same clock.
 *
 * Invariants:
 *  - a chat lives 15 days from creation (or from the owner's last refresh);
 *  - expiry is evaluated on every read/write, never trusted to the cron sweep;
 *  - only the owner may refresh, and only while the chat is still alive;
 *  - a closed chat (squad cancelled) is terminal.
 */

const CHAT_TTL_DAYS = 15;
const CHAT_TTL_MS = CHAT_TTL_DAYS * 24 * 60 * 60 * 1000;

const idOf = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return String(value._id);
  return String(value);
};

/** Expiry timestamp for a chat created or refreshed at `now`. */
function expiryFrom(now = new Date()) {
  return new Date(new Date(now).getTime() + CHAT_TTL_MS);
}

/** Milliseconds until expiry, floored at 0. */
function msRemaining(chat, now = new Date()) {
  if (!chat?.expiresAt) return 0;
  return Math.max(0, new Date(chat.expiresAt).getTime() - new Date(now).getTime());
}

/**
 * Has this chat run out?
 * A closed chat is not "expired" — it was ended, which is a different state and
 * renders differently.
 */
function isExpired(chat, now = new Date()) {
  if (!chat) return true;
  if (chat.state === 'closed') return false;
  return new Date(chat.expiresAt).getTime() <= new Date(now).getTime();
}

/** True when the chat can be read from / written to right now. */
function isOpen(chat, now = new Date()) {
  return Boolean(chat) && chat.state === 'active' && !isExpired(chat, now);
}

/** Is this user a participant (owner or invited member)? */
function isChatMember(chat, userId) {
  const id = idOf(userId);
  if (!chat || !id) return false;
  if (idOf(chat.ownerUserId) === id) return true;
  return (chat.memberIds || []).some((memberId) => idOf(memberId) === id);
}

/**
 * @returns {{ok: boolean, reason?: string, code?: string}}
 */
function canRefresh(chat, userId, now = new Date()) {
  if (!chat) return { ok: false, code: 'NOT_FOUND', reason: 'Squad chat not found.' };
  if (chat.state === 'closed') {
    return { ok: false, code: 'CLOSED', reason: 'This squad chat has been closed.' };
  }
  if (chat.state === 'expired' || isExpired(chat, now)) {
    return { ok: false, code: 'EXPIRED', reason: 'This squad chat has expired.' };
  }
  if (idOf(chat.ownerUserId) !== idOf(userId)) {
    return { ok: false, code: 'FORBIDDEN', reason: 'Only the squad leader can extend this chat.' };
  }
  return { ok: true };
}

/** Human-facing "3d 4h left" — used by the drawer. */
function formatRemaining(chat, now = new Date()) {
  const ms = msRemaining(chat, now);
  if (!ms) return 'expired';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days >= 1) return `${days}d ${hours}h left`;
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  return hours >= 1 ? `${hours}h left` : `${minutes}m left`;
}

module.exports = {
  CHAT_TTL_DAYS,
  CHAT_TTL_MS,
  expiryFrom,
  msRemaining,
  isExpired,
  isOpen,
  isChatMember,
  canRefresh,
  formatRemaining
};
