/**
 * Session lifetime: one access token, one rotating refresh token.
 *
 * A single cookie cannot be both short enough that theft is cheap to contain
 * and long enough that a person stays signed in. The session is therefore two
 * tokens:
 *
 *   access  30 minutes, httpOnly cookie, every request. `sv` carries the
 *           account's session version, so "sign out everywhere" retires every
 *           access token already in the wild. The cookie itself lives as long
 *           as the refresh token: the token's `exp` is the limit, and a cookie
 *           that expired alongside it would make the browser send nothing at
 *           all, which reads as "signed out" instead of "ready for a refresh".
 *   refresh 30 days, httpOnly cookie, only `POST /api/auth/refresh` reads it.
 *           Its hash is stored on a SessionToken row; every use replaces it.
 *
 * Rotation is what makes a stolen refresh token worth little: presenting one
 * that was already used means two parties hold the same token, and the safe
 * answer is to end every session on that account. A refresh that arrives after
 * 14 days of inactivity is refused for the same reason a locked screen asks for
 * the password again.
 *
 * Cookie policy lives in `utils/cookies.js`; the CSRF token that pairs with the
 * session lives in `utils/csrf.js`.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const SessionToken = require('../models/SessionToken');
const User = require('../models/User');
const { sessionCookieOptions, clearingCookieOptions, csrfCookieOptions } = require('./cookies');
const { CSRF_COOKIE, issueCsrfToken } = require('./csrf');

const ACCESS_COOKIE = 'jwt';
const REFRESH_COOKIE = 'gh_refresh';
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const IDLE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
// A replaced row stays readable for a week: long enough to recognise a replay.
const REPLACED_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_BYTES = 48;

/**
 * How long an access token lives.
 *
 * `ACCESS_TOKEN_TTL_SECONDS` exists so a browser check or a slow test can watch a
 * real expiry without waiting half an hour. It is refused in production, where
 * the session length must not depend on an environment variable.
 */
const configuredAccessSeconds = Number(process.env.ACCESS_TOKEN_TTL_SECONDS);
const ACCESS_TTL_MS =
  process.env.NODE_ENV !== 'production' &&
  Number.isFinite(configuredAccessSeconds) &&
  configuredAccessSeconds >= 5
    ? configuredAccessSeconds * 1000
    : 30 * 60 * 1000;

/** A refusal this module raises on purpose, with a machine-readable code. */
class SessionError extends Error {
  constructor(code, message, status = 401) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
    this.status = status;
  }
}

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const newToken = () => crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');

/** Mint the access token and put it in the cookie every request carries. */
function mintAccessToken(res, userId, sessionVersion = 0) {
  const token = jwt.sign(
    { userId, sv: Number(sessionVersion) || 0, typ: 'access' },
    process.env.JWT_SECRET,
    { expiresIn: Math.floor(ACCESS_TTL_MS / 1000) },
  );
  res.cookie(ACCESS_COOKIE, token, sessionCookieOptions(REFRESH_TTL_MS));
  return token;
}

/** Remove every cookie this module owns, including the CSRF token. */
function clearSessionCookies(res) {
  const options = clearingCookieOptions();
  res.cookie(ACCESS_COOKIE, '', options);
  res.cookie(REFRESH_COOKIE, '', options);
  res.cookie(CSRF_COOKIE, '', csrfCookieOptions(0));
}

/**
 * Start a session: one refresh record, one access token, both cookies, plus the
 * CSRF token the client echoes on mutations.
 * @returns {Promise<string>} the access token
 */
async function startSession(res, userId, sessionVersion = 0, userAgent = '') {
  const now = new Date();
  const refresh = newToken();
  await SessionToken.create({
    userId,
    tokenHash: hashToken(refresh),
    sessionVersion: Number(sessionVersion) || 0,
    lastUsedAt: now,
    expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
    userAgent: String(userAgent || '').slice(0, 200),
  });

  res.cookie(REFRESH_COOKIE, refresh, sessionCookieOptions(REFRESH_TTL_MS));
  issueCsrfToken(res);
  return mintAccessToken(res, userId, sessionVersion);
}

async function revokeAllSessions(userId) {
  await SessionToken.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date(), replaced: true } },
  );
}

/**
 * Exchange a refresh token for a new pair.
 *
 * Every refusal ends the same way the browser would after a sign-out: the
 * cookies are cleared, so a client cannot sit in a retry loop with a token that
 * will never work.
 *
 * @returns {Promise<{token: string, user: {id: string, username: string}}>}
 */
async function rotateSession(req, res) {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (!presented) throw new SessionError('REFRESH_MISSING', 'There is no session to refresh.');

  const record = await SessionToken.findOne({ tokenHash: hashToken(presented) });
  if (!record) throw new SessionError('REFRESH_INVALID', 'This session is no longer valid.');

  const now = new Date();

  // A rotated token used again is a copy: the real browser already moved on.
  // The whole account is signed out, because the token must be assumed leaked.
  if (record.replaced) {
    await revokeAllSessions(record.userId);
    throw new SessionError('REFRESH_REPLAYED', 'This session was already used. Sign in again.');
  }
  if (record.revokedAt) {
    throw new SessionError('SESSION_REVOKED', 'This session was signed out.');
  }
  if (record.expiresAt <= now) {
    throw new SessionError('REFRESH_EXPIRED', 'This session has expired. Sign in again.');
  }
  if (now.getTime() - new Date(record.lastUsedAt).getTime() > IDLE_TTL_MS) {
    await SessionToken.updateOne({ _id: record._id }, { $set: { revokedAt: now } });
    throw new SessionError(
      'SESSION_IDLE',
      'This session expired after two weeks of inactivity. Sign in again.',
    );
  }

  const user = await User.findById(record.userId)
    .select('_id username status sessionVersion')
    .lean();
  const versionMatches = user && Number(user.sessionVersion) === Number(record.sessionVersion);
  if (!user || user.status === 'deleted' || !versionMatches) {
    await revokeAllSessions(record.userId);
    throw new SessionError('SESSION_REVOKED', 'This session was signed out.');
  }

  // Conditional claim: two browsers refreshing the same token at once must not
  // both be handed a new one.
  const claimed = await SessionToken.findOneAndUpdate(
    { _id: record._id, replaced: false, revokedAt: null },
    {
      $set: {
        replaced: true,
        lastUsedAt: now,
        expiresAt: new Date(now.getTime() + REPLACED_KEEP_MS),
      },
    },
  );
  if (!claimed) {
    await revokeAllSessions(record.userId);
    throw new SessionError('REFRESH_REPLAYED', 'This session was already used. Sign in again.');
  }

  const refresh = newToken();
  await SessionToken.create({
    userId: user._id,
    tokenHash: hashToken(refresh),
    sessionVersion: Number(user.sessionVersion) || 0,
    lastUsedAt: now,
    expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
    userAgent: String(record.userAgent || '').slice(0, 200),
  });

  res.cookie(REFRESH_COOKIE, refresh, sessionCookieOptions(REFRESH_TTL_MS));
  // Hand the page a CSRF token if it lost one; otherwise keep the current value.
  issueCsrfToken(res, req.cookies?.[CSRF_COOKIE]);

  return {
    token: mintAccessToken(res, user._id, user.sessionVersion),
    user: { id: String(user._id), username: user.username },
  };
}

/** End this browser's session. Other devices are untouched. */
async function endSession(req, res) {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (presented) {
    await SessionToken.updateOne(
      { tokenHash: hashToken(presented), revokedAt: null },
      { $set: { revokedAt: new Date(), replaced: true } },
    );
  }
  clearSessionCookies(res);
}

module.exports = {
  SessionError,
  clearSessionCookies,
  startSession,
  rotateSession,
  endSession,
  revokeAllSessions,
};
