/**
 * Two-tier cache: in-process L1, Upstash Redis L2.
 *
 * L1 keeps the hot path at zero network cost; L2 survives deploys and Render
 * restarts, which is where the in-memory cache used to lose everything.
 *
 * Failure policy: if Redis errors, the request is served from L1 (or the
 * loader) and Redis is skipped for 30 seconds. A cache outage must never turn
 * into an app outage, and it must not add a failing HTTP call to every request
 * while the outage lasts.
 */
const { getRedis, redisKey } = require('../config/redis');
const { createTtlCache } = require('./cache');

const DEFAULT_TTL_SECONDS = 300;
const DEGRADE_MS = 30_000;

const memory = createTtlCache({ ttlMs: DEFAULT_TTL_SECONDS * 1000, maxEntries: 200 });
const inflight = new Map();

let degradedUntil = 0;
let warned = false;

const activeClient = () => (Date.now() < degradedUntil ? null : getRedis());

function degrade(err) {
  degradedUntil = Date.now() + DEGRADE_MS;
  if (!warned) {
    warned = true;
    console.error('[redisCache] falling back to memory for 30s:', err.message);
  }
}

const hit = (value) => value !== undefined && value !== null;

async function cacheGet(key) {
  const redis = activeClient();
  if (redis) {
    try {
      const value = await redis.get(redisKey(key));
      if (hit(value)) return value;
    } catch (err) {
      degrade(err);
    }
  }
  return memory.get(key);
}

async function cacheSet(key, value, ttlSeconds = DEFAULT_TTL_SECONDS) {
  memory.set(key, value, ttlSeconds * 1000);
  const redis = activeClient();
  if (!redis) return value;
  try {
    await redis.set(redisKey(key), value, { ex: ttlSeconds });
  } catch (err) {
    degrade(err);
  }
  return value;
}

/**
 * Read-through helper with per-process miss collapsing. Only successful loads
 * are cached; a loader that throws leaves both tiers untouched.
 */
async function cacheWrap(key, loader, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const cached = await cacheGet(key);
  if (hit(cached)) return cached;

  if (inflight.has(key)) return inflight.get(key);

  const promise = (async () => {
    try {
      const value = await loader();
      await cacheSet(key, value, ttlSeconds);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/** Drop a key from both tiers (use after a write that invalidates a summary). */
async function cacheDelete(key) {
  memory.delete(key);
  const redis = activeClient();
  if (!redis) return;
  try {
    await redis.del(redisKey(key));
  } catch (err) {
    degrade(err);
  }
}

/** Test helper. */
function resetCacheLayer() {
  memory.clear();
  inflight.clear();
  degradedUntil = 0;
  warned = false;
}

module.exports = {
  cacheGet,
  cacheSet,
  cacheWrap,
  cacheDelete,
  resetCacheLayer,
  DEFAULT_TTL_SECONDS
};
