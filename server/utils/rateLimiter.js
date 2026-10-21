/**
 * In-memory rate limiting primitives.
 *
 * The socket engine is per-process, so a Map is sufficient here. REST rate
 * limiting uses express-rate-limit (see server/app.js).
 */

/**
 * Sliding-window limiter keyed by an arbitrary string (use the user id, not the
 * socket id, so opening ten tabs does not multiply the budget).
 */
function createSlidingWindowLimiter({ windowMs, max, maxKeys = 20000 }) {
  const buckets = new Map();
  let lastSweep = 0;

  const sweep = (now) => {
    if (now - lastSweep < 60_000) return;
    lastSweep = now;
    for (const [key, hits] of buckets) {
      while (hits.length && now - hits[0] > windowMs) hits.shift();
      if (!hits.length) buckets.delete(key);
    }
  };

  return {
    /**
     * @returns {{allowed: boolean, remaining: number, retryAfterMs: number}}
     */
    consume(key, now = Date.now()) {
      sweep(now);
      let hits = buckets.get(key);
      if (!hits) {
        if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value);
        hits = [];
        buckets.set(key, hits);
      }
      while (hits.length && now - hits[0] > windowMs) hits.shift();

      if (hits.length >= max) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: Math.max(0, windowMs - (now - hits[0]))
        };
      }
      hits.push(now);
      return { allowed: true, remaining: max - hits.length, retryAfterMs: 0 };
    },
    reset() {
      buckets.clear();
    }
  };
}

/**
 * Tracks the last timestamp of an event per key, with expiry and a hard cap so
 * long-lived processes cannot leak memory.
 */
function createRecentEventTracker({ maxAgeMs, maxKeys = 20000 }) {
  const map = new Map();
  let lastSweep = 0;

  const sweep = (now) => {
    if (now - lastSweep < 60_000) return;
    lastSweep = now;
    for (const [key, ts] of map) {
      if (now - ts > maxAgeMs) map.delete(key);
    }
  };

  return {
    get(key) {
      return map.get(key) || 0;
    },
    set(key, now = Date.now()) {
      sweep(now);
      if (!map.has(key) && map.size >= maxKeys) map.delete(map.keys().next().value);
      map.set(key, now);
    },
    /**
     * Records the event only if the key has been quiet for `minIntervalMs`.
     * @returns {boolean} true when the event may proceed
     */
    touch(key, minIntervalMs, now = Date.now()) {
      sweep(now);
      const last = map.get(key) || 0;
      if (now - last < minIntervalMs) return false;
      if (!map.has(key) && map.size >= maxKeys) map.delete(map.keys().next().value);
      map.set(key, now);
      return true;
    },
    reset() {
      map.clear();
    }
  };
}

module.exports = { createSlidingWindowLimiter, createRecentEventTracker };
