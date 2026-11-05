/**
 * Per-surface rate limits for endpoints whose cost grows with load.
 *
 * The coarse limiter in `app.js` protects the process as a whole; these protect
 * the expensive queries (text search, regex lookups, third-party fetches) so one
 * account cannot make the database do thousands of index scans while ordinary
 * browsing continues to work.
 *
 * Authenticated callers are keyed by user id, everyone else by IP, so a shared
 * NAT cannot lock a household out because one device hammered search. IPv6 is
 * grouped by /64 for the same reason express-rate-limit groups it.
 */
const rateLimit = require('express-rate-limit');

function clientKey(req) {
  const userId = req.user?._id || req.user?.id;
  if (userId) return `user:${userId}`;

  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (!ip.includes(':')) return `ip:${ip}`;

  // Group by prefix (/64): one host can rotate through a whole /64 range, so
  // keying on the full address would let it reset its budget at will.
  const groups = ip.split(':').filter(Boolean).slice(0, 4);
  return `ip:${groups.join(':')}::/64`;
}

/**
 * @param {object} options
 * @param {number} options.windowMs
 * @param {number} options.max
 * @param {string} options.message
 */
function createLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // The handler below is checked before any request is served; the key
    // generator is ours, so the library's IPv6 heuristic does not apply.
    validate: false,
    keyGenerator: clientKey,
    message: { message }
  });
}

// Text search + regex prefix lookups. 45/min is comfortable for a person and
// ruinous for a script: each hit can touch the text index three times.
const searchLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: Number(process.env.SEARCH_RATE_LIMIT_MAX) || 45,
  message: 'You are searching very quickly. Give it a minute and try again.'
});

// The game catalog proxies a third-party API and is cached; the limiter is
// about protecting that quota, not the database.
const catalogLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: Number(process.env.CATALOG_RATE_LIMIT_MAX) || 90,
  message: 'Too many catalog requests. Try again in a minute.'
});

// Admin dashboards aggregate every collection; a refresh loop is expensive.
const adminLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: Number(process.env.ADMIN_RATE_LIMIT_MAX) || 120,
  message: 'Too many admin requests. Slow down.'
});

// Community browse + room reads: high enough for normal navigation and socket
// reconnects, low enough to stop a crawler from walking every server.
const browseLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: Number(process.env.BROWSE_RATE_LIMIT_MAX) || 180,
  message: 'Too many requests. Please slow down.'
});

module.exports = {
  clientKey,
  createLimiter,
  searchLimiter,
  catalogLimiter,
  adminLimiter,
  browseLimiter
};
