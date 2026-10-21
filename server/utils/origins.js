/**
 * CORS / socket origin policy.
 *
 * Exact origins only. `CLIENT_URL` accepts a comma-separated list; extra
 * preview deployments must be listed explicitly in `EXTRA_ALLOWED_ORIGINS`.
 * Wildcard TLD matching (the previous `.vercel.app` rule) is intentionally gone:
 * anyone can deploy to a vercel.app subdomain, and with credentialed CORS that
 * is a full account takeover primitive.
 *
 * Loopback origins are allowed outside production so `vite` on any port works.
 */

const { HttpError } = require('./httpError');

const stripTrailingSlash = (value) => value.trim().replace(/\/+$/, '');

let cached = null;

const DEFAULT_PRODUCTION_ORIGINS = [
  'https://gamer-hub-alpha.vercel.app',
  'https://gamerhub.vercel.app'
];

function configuredOrigins() {
  if (cached) return cached;
  const envOrigins = [process.env.CLIENT_URL, process.env.EXTRA_ALLOWED_ORIGINS]
    .filter(Boolean)
    .join(',')
    .split(',')
    .map(stripTrailingSlash)
    .filter(Boolean);

  cached = Array.from(new Set([...envOrigins, ...DEFAULT_PRODUCTION_ORIGINS]));
  return cached;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isLoopbackOrigin(origin) {
  try {
    const { hostname } = new URL(origin);
    return LOOPBACK_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

/** @param {string|undefined} origin */
function isAllowedOrigin(origin) {
  // Non-browser clients (curl, mobile, server-to-server) send no Origin header.
  if (!origin) return true;

  const clean = stripTrailingSlash(origin);
  if (configuredOrigins().includes(clean)) return true;

  if (process.env.NODE_ENV !== 'production' && isLoopbackOrigin(clean)) return true;

  return false;
}

/**
 * CORS middleware options shared by Express and Socket.io.
 * Disallowed origins are rejected (403) rather than merely stripped of CORS
 * headers: a browser would hide the response, but the mutation would already
 * have executed — which is exactly a CSRF primitive.
 */
const corsOrigin = (origin, callback) => {
  if (isAllowedOrigin(origin)) return callback(null, true);
  return callback(new HttpError(403, 'Origin not allowed'));
};

/** Clear the cached allow-list (tests / runtime config changes). */
function resetOriginCache() {
  cached = null;
}

module.exports = { isAllowedOrigin, corsOrigin, configuredOrigins, resetOriginCache };
