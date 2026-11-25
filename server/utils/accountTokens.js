const crypto = require('crypto');
const AccountToken = require('../models/AccountToken');

const PURPOSES = Object.freeze({
  VERIFY_EMAIL: 'verify_email',
  RESET_PASSWORD: 'reset_password',
});

const TTL_MS = Object.freeze({
  [PURPOSES.VERIFY_EMAIL]: 24 * 60 * 60 * 1000,
  [PURPOSES.RESET_PASSWORD]: 30 * 60 * 1000,
});

/** SHA-256 is enough here: the token itself has 256 bits of entropy. */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Issue a fresh token and retire any previous live token for the same purpose.
 * The caller is responsible for delivering the raw token; it is never stored.
 */
async function issueAccountToken(userId, purpose) {
  const ttl = TTL_MS[purpose];
  if (!ttl) throw new Error(`Unknown account token purpose: ${purpose}`);

  const now = new Date();
  await AccountToken.updateMany({ userId, purpose, usedAt: null }, { $set: { usedAt: now } });

  const token = newToken();
  await AccountToken.create({
    userId,
    purpose,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + ttl),
  });

  return token;
}

/**
 * Atomically mark a token used. The update, not a read-then-write pair, is the
 * arbiter when two tabs submit the same link at once.
 */
async function consumeAccountToken(token, purpose) {
  if (typeof token !== 'string') return null;
  const value = token.trim();
  if (value.length < 32 || value.length > 200) return null;

  return AccountToken.findOneAndUpdate(
    {
      tokenHash: hashToken(value),
      purpose,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    },
    { $set: { usedAt: new Date() } },
    { new: true },
  ).lean();
}

async function invalidateAccountTokens(userId, purpose) {
  await AccountToken.updateMany(
    { userId, purpose, usedAt: null },
    { $set: { usedAt: new Date() } },
  );
}

module.exports = {
  PURPOSES,
  TTL_MS,
  hashToken,
  issueAccountToken,
  consumeAccountToken,
  invalidateAccountTokens,
};
