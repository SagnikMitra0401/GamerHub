/**
 * Double-submit CSRF check for cookie-authenticated mutations.
 *
 * The session cookie is httpOnly, so a cross-site form post can make the browser
 * send it. A random value in a cookie the page can read, echoed in a header only
 * same-origin script can set, proves the request came from the application
 * rather than from a form on another site.
 *
 * Three rules keep it from breaking real traffic:
 *   - A safe method is never checked. Reads do not change state.
 *   - A request with no session cookie has nothing to forge. Signing in and
 *     registering happen before a session exists.
 *   - A request authenticated by an `Authorization` header alone carries no
 *     cookie for a browser to replay, so it needs no token. This is what keeps
 *     the socket handshake and scripting clients working.
 *
 * A refusal is not a dead end. Somebody who signed in before this check shipped
 * holds a session cookie and no `gh_csrf` cookie, so their first mutation is
 * refused through no fault of their own. The refusal sets a token, and the
 * client replays the request once with it. A form on another site cannot read a
 * cross-origin response, so the token it never sees is useless to it.
 *
 * The comparison is length-checked then constant-time, so a wrong token costs
 * the same as a missing one.
 */

const crypto = require('crypto');

const { csrfCookieOptions } = require('./cookies');

const CSRF_COOKIE = 'gh_csrf';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Paths that establish or repair a session, relative to the mount point.
 *
 * A browser can hold an expired session cookie, and those paths are how it gets
 * out of that state. Requiring a token there would lock the account out until
 * the cookies were cleared by hand, so sign-in and recovery stay exempt. A
 * forged sign-in is answerable by the credentials themselves; a forged
 * password reset is answered by the mailed code.
 */
const SESSION_ENTRY_PATHS = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/google',
  '/auth/refresh',
  '/auth/logout',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/verify-email',
  '/auth/recovery/start',
  '/auth/recovery/verify',
]);

const newToken = () => crypto.randomBytes(24).toString('base64url');

/**
 * Put a token where the page can read it. Called when a session starts, when a
 * refresh token is exchanged, and when a request is refused, so a browser that
 * lost the cookie gets one back.
 */
function issueCsrfToken(res, token = newToken()) {
  res.cookie(CSRF_COOKIE, token, csrfCookieOptions());
  return token;
}

function sameToken(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

/** Express middleware. Mounted once, before the routers. */
function csrfProtect(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (SESSION_ENTRY_PATHS.has(req.path)) return next();

  const cookieSession = Boolean(req.cookies?.jwt || req.cookies?.gh_refresh);
  if (!cookieSession) return next();

  if (sameToken(req.cookies?.[CSRF_COOKIE], req.get(CSRF_HEADER))) return next();

  // The refusal sets the token the next request is compared against, so the
  // browser that was signed in before this check existed is one reload away
  // from working. The message names that reload: a page still running the
  // previous bundle has no retry of its own, and nothing in the body can help
  // it, because the server compares a cookie and never reads a body.
  issueCsrfToken(res);
  return res.status(403).json({
    code: 'CSRF_REQUIRED',
    message: 'This tab is out of date. Reload the page to continue.',
  });
}

module.exports = {
  CSRF_COOKIE,
  CSRF_HEADER,
  SAFE_METHODS,
  SESSION_ENTRY_PATHS,
  issueCsrfToken,
  csrfProtect,
};
