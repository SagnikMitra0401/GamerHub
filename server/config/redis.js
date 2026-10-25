/**
 * Redis feature switch.
 *
 * Redis is off by default: the Upstash free tier has a daily command quota, and
 * an idle GamerHub instance should not spend it. Everything that could use
 * Redis already falls back to an in-process path when `getRedis()` is null, so
 * turning it off costs durability across restarts, never correctness.
 *
 * ENABLE: set REDIS_ENABLED=1 plus UPSTASH_REDIS_REST_URL/_TOKEN. That is the
 * whole change — the client lives in redisClient.js and is always present.
 */
const { createRedisClient, resetRedisClient } = require('./redisClient');

const KEY_PREFIX = 'gamerhub:';

const enabled = () => String(process.env.REDIS_ENABLED || '').toLowerCase() === '1';

/** The Redis client, or null when the feature switch is off. */
const getRedis = () => (enabled() ? createRedisClient() : null);

/** True only when Redis is switched on *and* both credentials are present. */
const isConfigured = () => Boolean(getRedis());

/** Namespaced key helper. */
const redisKey = (suffix) => `${KEY_PREFIX}${suffix}`;

/** Test helper: drop the memoised client. */
const resetRedis = () => resetRedisClient();

module.exports = { getRedis, isConfigured, redisKey, resetRedis, KEY_PREFIX };
