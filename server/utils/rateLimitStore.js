/**
 * Shared rate-limit counter store.
 *
 * With Redis enabled, every per-surface and account quota uses one Upstash key
 * so two API instances enforce the same budget. With Redis off (the default),
 * the same class falls back to an in-process fixed window and nothing changes
 * for a single-instance deployment.
 *
 * The coarse global limiter in app.js deliberately stays local: it is a
 * process-protection guard, not a user quota, and counting every request in
 * Redis would spend the free Upstash command budget for no security gain.
 */
const { getRedis, redisKey, isConfigured } = require('../config/redis');

const DEGRADE_MS = 30_000;

class LocalWindowStore {
  constructor(windowMs) {
    this.windowMs = windowMs;
    this.buckets = new Map();
  }

  setWindow(windowMs) {
    this.windowMs = windowMs;
  }

  get(key) {
    const bucket = this.buckets.get(key);
    if (!bucket) return undefined;
    if (bucket.resetTime.getTime() <= Date.now()) {
      this.buckets.delete(key);
      return undefined;
    }
    return { totalHits: bucket.totalHits, resetTime: bucket.resetTime };
  }

  increment(key) {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetTime.getTime() <= now) {
      bucket = { totalHits: 0, resetTime: new Date(now + this.windowMs) };
      this.buckets.set(key, bucket);
    }
    bucket.totalHits += 1;
    return { totalHits: bucket.totalHits, resetTime: bucket.resetTime };
  }

  decrement(key) {
    const bucket = this.buckets.get(key);
    if (bucket && bucket.totalHits > 0) bucket.totalHits -= 1;
  }

  resetKey(key) {
    this.buckets.delete(key);
  }

  resetAll() {
    this.buckets.clear();
  }
}

class SharedRateLimitStore {
  constructor(name) {
    this.name = name;
    this.windowMs = 60_000;
    this.local = new LocalWindowStore(this.windowMs);
    this.localKeys = false;
    this.prefix = `rl:${name}:`;
    this.degradedUntil = 0;
    this.warned = false;
  }

  init(options) {
    if (Number.isFinite(options?.windowMs) && options.windowMs > 0) {
      this.windowMs = options.windowMs;
      this.local.setWindow(options.windowMs);
    }
  }

  key(key) {
    return redisKey(`ratelimit:${this.name}:${key}`);
  }

  activeRedis() {
    if (Date.now() < this.degradedUntil) return null;
    return getRedis();
  }

  degrade(err) {
    this.degradedUntil = Date.now() + DEGRADE_MS;
    if (!this.warned) {
      this.warned = true;
      console.error(
        `[RateLimit:${this.name}] Redis unavailable, using memory for 30s:`,
        err.message,
      );
    }
  }

  async increment(key) {
    const redis = this.activeRedis();
    if (!redis) return this.local.increment(key);

    try {
      const redisKeyName = this.key(key);
      const totalHits = Number(await redis.incr(redisKeyName));
      if (totalHits === 1) await redis.pexpire(redisKeyName, this.windowMs);

      let ttl = Number(await redis.pttl(redisKeyName));
      if (!Number.isFinite(ttl) || ttl < 0) {
        // A crash between INCR and PEXPIRE must not create a permanent key.
        await redis.pexpire(redisKeyName, this.windowMs);
        ttl = this.windowMs;
      }

      return { totalHits, resetTime: new Date(Date.now() + ttl) };
    } catch (err) {
      this.degrade(err);
      return this.local.increment(key);
    }
  }

  async get(key) {
    const redis = this.activeRedis();
    if (!redis) return this.local.get(key);

    try {
      const value = await redis.get(this.key(key));
      if (value === null || value === undefined) return undefined;
      const ttl = Number(await redis.pttl(this.key(key)));
      return {
        totalHits: Number(value),
        resetTime: ttl > 0 ? new Date(Date.now() + ttl) : undefined,
      };
    } catch (err) {
      this.degrade(err);
      return this.local.get(key);
    }
  }

  async decrement(key) {
    const redis = this.activeRedis();
    if (!redis) return this.local.decrement(key);

    try {
      const value = await redis.decr(this.key(key));
      if (Number(value) < 0) {
        // Keep the key from becoming permanent; DECR preserves TTL, SET does not.
        await redis.set(this.key(key), 0, { px: this.windowMs });
      }
    } catch (err) {
      this.degrade(err);
      this.local.decrement(key);
    }
  }

  async resetKey(key) {
    const redis = this.activeRedis();
    if (redis) {
      try {
        await redis.del(this.key(key));
      } catch (err) {
        this.degrade(err);
      }
    }
    this.local.resetKey(key);
  }

  async resetAll() {
    this.local.resetAll();
  }
}

function createRateLimitStore(name) {
  return new SharedRateLimitStore(name);
}

function rateLimitStoreStatus() {
  const shared = isConfigured();
  return {
    mode: shared ? 'redis' : 'memory',
    shared,
  };
}

module.exports = {
  LocalWindowStore,
  SharedRateLimitStore,
  createRateLimitStore,
  rateLimitStoreStatus,
};
