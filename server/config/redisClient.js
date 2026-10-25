/**
 * Upstash Redis client (HTTP REST, no persistent TCP socket).
 *
 * Kept separate from `redis.js` so the client implementation is never the thing
 * that gets switched off: `redis.js` decides *whether* Redis is used, this file
 * knows *how* to talk to it. Re-enabling Redis is therefore an env-var change,
 * not a code restore.
 *
 * The SDK is required lazily. With Redis off the package is never loaded, so a
 * fresh clone that has not run `npm install` yet (or an install that skipped
 * optional deps) still boots the API instead of dying in a require.
 */
let RedisCtor;
let lookedUp = false;

let client = null;
let warned = false;

function loadRedisCtor() {
  if (lookedUp) return RedisCtor;
  lookedUp = true;
  try {
    ({ Redis: RedisCtor } = require('@upstash/redis'));
  } catch {
    RedisCtor = null;
  }
  return RedisCtor;
}

function credentials() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

/**
 * The memoised Upstash client, or null when it cannot be built. Callers treat
 * null as "use the in-process fallback".
 */
function createRedisClient() {
  if (client) return client;

  const creds = credentials();
  if (!creds) {
    if (!warned) {
      warned = true;
      console.warn('[redis] UPSTASH credentials are not set; using memory fallbacks.');
    }
    return null;
  }

  const Redis = loadRedisCtor();
  if (!Redis) {
    if (!warned) {
      warned = true;
      console.warn('[redis] @upstash/redis is not installed; run `npm install` to enable Redis.');
    }
    return null;
  }

  client = new Redis({
    url: creds.url,
    token: creds.token,
    // One retry keeps a transient blip from turning into a request failure;
    // the cache layer degrades for 30s after a second failure anyway.
    retry: { retries: 1, backoff: () => 50 }
  });
  return client;
}

/** Test helper: forget the memoised client so env changes take effect. */
function resetRedisClient() {
  client = null;
  warned = false;
}

module.exports = { createRedisClient, resetRedisClient };
