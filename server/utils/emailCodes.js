const crypto = require('crypto');
const EmailChallenge = require('../models/EmailChallenge');
const { sessionOptions } = require('./transaction');

const PURPOSES = Object.freeze({
  VERIFY_EMAIL: 'verify_email',
  VERIFY_RECOVERY: 'verify_recovery',
  RECOVER_ACCOUNT: 'recover_account',
});

const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const CODE_LENGTH = 8;
const CODE_PATTERN = /^\d{8}$/;

/**
 * Server-only secret that turns an 8-digit space into a keyed one. Without it a
 * stolen database could be brute-forced offline in under a second, because one
 * hundred million candidates is nothing for a GPU.
 *
 * Production fails closed. Local development and tests derive a value from
 * JWT_SECRET so a developer never has to invent one just to register.
 */
function pepper() {
  const configured = String(process.env.EMAIL_CODE_PEPPER || '').trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('EMAIL_CODE_PEPPER must be set in production.');
  }
  return `local:${process.env.JWT_SECRET || 'gamerhub-local-dev'}`;
}

/** HMAC-SHA256 over user, purpose and code, so a hash cannot be replayed elsewhere. */
function hashCode(userId, purpose, code) {
  return crypto
    .createHmac('sha256', pepper())
    .update(`${String(userId)}:${purpose}:${String(code)}`)
    .digest('hex');
}

/** Uniform 8-digit code. `randomInt` is cryptographic, unlike `Math.random`. */
function generateCode() {
  return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

function isCode(value) {
  return typeof value === 'string' && CODE_PATTERN.test(value);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left), 'utf8');
  const b = Buffer.from(String(right), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Issue a code and retire the previous live one. The raw code is returned to the
 * caller for delivery and never stored.
 */
async function issueEmailChallenge(userId, purpose, { target = '' } = {}) {
  if (!Object.values(PURPOSES).includes(purpose)) {
    throw new Error(`Unknown email challenge purpose: ${purpose}`);
  }

  const now = new Date();
  const code = generateCode();
  const doc = {
    userId,
    purpose,
    target: String(target || '').slice(0, 254),
    codeHash: hashCode(userId, purpose, code),
    attempts: 0,
    expiresAt: new Date(now.getTime() + TTL_MS),
  };

  await EmailChallenge.updateMany(
    { userId, purpose, consumedAt: null },
    { $set: { consumedAt: now } },
  );

  let created;
  try {
    created = await EmailChallenge.create(doc);
  } catch (err) {
    // Two parallel sends can collide on the live-challenge index. The retry
    // retires whatever won the race, so the code the user just received stays
    // the only valid one.
    if (err && err.code === 11000) {
      await EmailChallenge.updateMany(
        { userId, purpose, consumedAt: null },
        { $set: { consumedAt: new Date() } },
      );
      created = await EmailChallenge.create(doc);
    } else {
      throw err;
    }
  }

  return { code, expiresAt: created.expiresAt, challengeId: String(created._id) };
}

/**
 * Check one attempt against the live challenge.
 *
 * The attempt is counted before the comparison runs, so a wrong code always
 * spends one of the five tries, even if the process dies mid-check.
 */
async function consumeEmailChallenge(userId, purpose, code) {
  if (!isCode(code)) return { ok: false, reason: 'malformed', attemptsRemaining: null };

  const now = new Date();
  const challenge = await EmailChallenge.findOne({ userId, purpose, consumedAt: null })
    .sort({ createdAt: -1 })
    .lean();

  if (!challenge) return { ok: false, reason: 'missing', attemptsRemaining: null };

  if (challenge.expiresAt.getTime() <= now.getTime()) {
    await EmailChallenge.updateOne(
      { _id: challenge._id, consumedAt: null },
      { $set: { consumedAt: now } },
    );
    return { ok: false, reason: 'expired', attemptsRemaining: 0 };
  }

  const counted = await EmailChallenge.findOneAndUpdate(
    { _id: challenge._id, consumedAt: null, attempts: { $lt: MAX_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { new: true },
  ).lean();

  if (!counted) return { ok: false, reason: 'locked', attemptsRemaining: 0 };

  if (!safeEqual(hashCode(userId, purpose, code), challenge.codeHash)) {
    return {
      ok: false,
      reason: 'mismatch',
      attemptsRemaining: Math.max(0, MAX_ATTEMPTS - counted.attempts),
    };
  }

  // Consume is the arbiter: two tabs submitting the right code at once must not
  // both receive a success.
  const won = await EmailChallenge.findOneAndUpdate(
    { _id: challenge._id, consumedAt: null },
    { $set: { consumedAt: now } },
    { new: true },
  ).lean();

  if (!won) return { ok: false, reason: 'missing', attemptsRemaining: 0 };
  return { ok: true, target: won.target || '' };
}

/** Retire every live challenge for a purpose, for example after a password reset. */
async function invalidateEmailChallenges(userId, purpose, session = null) {
  await EmailChallenge.updateMany(
    { userId, purpose, consumedAt: null },
    { $set: { consumedAt: new Date() } },
    sessionOptions(EmailChallenge, session),
  );
}

module.exports = {
  PURPOSES,
  TTL_MS,
  MAX_ATTEMPTS,
  CODE_LENGTH,
  generateCode,
  isCode,
  hashCode,
  issueEmailChallenge,
  consumeEmailChallenge,
  invalidateEmailChallenges,
};
