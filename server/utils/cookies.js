/**
 * Cookie policy for the session, in one place.
 *
 * The policy follows the deployment topology, not the build mode. A same-site
 * deployment — the API and the web app behind one origin, which is what the Vite
 * proxy does in development — keeps `lax`: a cross-site form post cannot carry
 * the cookie at all, so the browser is the first defense and the CSRF header the
 * second. A split deployment (the app on its own host, the API on another) needs
 * `none`, because `lax` would drop the cookie on every cross-site request; there
 * the CSRF header carries the whole defense and the refresh token's session
 * record stops a replay.
 *
 * `COOKIE_SAMESITE` overrides the default for an unusual topology. `none`
 * requires `secure`, which only production sets, so it is the wrong value for a
 * loopback deployment.
 */

const SAME_SITE_VALUES = new Set(['lax', 'none', 'strict']);

/** The configured value, or the one this deployment needs. */
function sameSitePolicy() {
  const configured = String(process.env.COOKIE_SAMESITE || '')
    .trim()
    .toLowerCase();
  if (SAME_SITE_VALUES.has(configured)) return configured;
  return process.env.NODE_ENV === 'production' ? 'none' : 'lax';
}

/** Flags for a cookie the browser sends back with every request. */
const sessionCookieOptions = (maxAge) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: sameSitePolicy(),
  maxAge,
  path: '/',
});

/** Flags that remove a session cookie. */
const clearingCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: sameSitePolicy(),
  expires: new Date(0),
  path: '/',
});

/**
 * Flags for the CSRF cookie. It is readable by the page on purpose: the client
 * has to echo it in a header, which a cross-site form cannot do.
 */
const csrfCookieOptions = (maxAge) => ({
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: sameSitePolicy(),
  maxAge,
  path: '/',
});

module.exports = {
  SAME_SITE_VALUES,
  sameSitePolicy,
  sessionCookieOptions,
  clearingCookieOptions,
  csrfCookieOptions,
};
