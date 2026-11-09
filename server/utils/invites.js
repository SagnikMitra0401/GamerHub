const crypto = require('crypto');

/**
 * Invite-link rules, kept pure so they can be tested without a database.
 *
 * An invite is a bearer token: whoever holds the code can join. It therefore
 * has to be unguessable, revocable, expirable and capped, and it can only ever
 * grant the member role.
 */

const MAX_USES_LIMIT = 100;
const MAX_EXPIRY_DAYS = 30;

/** 12 URL-safe characters (~72 bits) — long enough that guessing is pointless. */
function newInviteCode() {
  return crypto.randomBytes(9).toString('base64url');
}

function normalizeInviteOptions(body = {}) {
  const errors = [];

  const role = String(body.role ?? 'member').trim().toLowerCase();
  if (role !== 'member') {
    errors.push('Invite links can only grant the member role.');
  }

  const maxUses = body.maxUses === undefined || body.maxUses === ''
    ? 0
    : Number(body.maxUses);
  if (!Number.isInteger(maxUses) || maxUses < 0 || maxUses > MAX_USES_LIMIT) {
    errors.push(`Use limit must be a whole number between 0 and ${MAX_USES_LIMIT}.`);
  }

  const expiresInDays = body.expiresInDays === undefined || body.expiresInDays === ''
    ? 0
    : Number(body.expiresInDays);
  if (!Number.isInteger(expiresInDays) || expiresInDays < 0 || expiresInDays > MAX_EXPIRY_DAYS) {
    errors.push(`Expiry must be a whole number of days between 0 and ${MAX_EXPIRY_DAYS}.`);
  }

  const requiresApproval = body.requiresApproval === true || body.requiresApproval === 'true';

  return {
    ok: errors.length === 0,
    errors,
    value: { role: 'member', maxUses, expiresInDays, requiresApproval }
  };
}

function inviteStatus(invite, now = Date.now()) {
  if (!invite) return 'missing';
  if (invite.revokedAt) return 'revoked';

  const expires = invite.expiresAt ? new Date(invite.expiresAt).getTime() : 0;
  if (expires && expires <= now) return 'expired';
  if (invite.maxUses > 0 && (invite.uses || 0) >= invite.maxUses) return 'used_up';

  return 'active';
}

const INVITE_STATUS_MESSAGES = Object.freeze({
  missing: 'That invite link does not exist.',
  revoked: 'That invite link was revoked.',
  expired: 'That invite link has expired.',
  used_up: 'That invite link has reached its use limit.'
});

module.exports = {
  MAX_USES_LIMIT,
  MAX_EXPIRY_DAYS,
  newInviteCode,
  normalizeInviteOptions,
  inviteStatus,
  INVITE_STATUS_MESSAGES
};
