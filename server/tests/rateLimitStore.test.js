/**
 * Shared rate-limit counter behaviour.
 *
 * Redis is faked at the client boundary, exactly like the cache tests, so the
 * feature switch, key prefix and command usage are the production code.
 */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { installFakeRedis, enableRedis, disableRedis, store } = require('./helpers/fakeRedis');

const redisStore = installFakeRedis();

const { resetRedis, redisKey } = require('../config/redis');
const { createRateLimitStore, rateLimitStoreStatus } = require('../utils/rateLimitStore');

beforeEach(() => {
  redisStore.reset();
  resetRedis();
  disableRedis();
});

test('without Redis the limiter uses a fixed local window and resetKey works', async () => {
  const limiter = createRateLimitStore('local');
  limiter.init({ windowMs: 60_000 });

  assert.equal((await limiter.increment('user:1')).totalHits, 1);
  assert.equal((await limiter.increment('user:1')).totalHits, 2);
  assert.equal((await limiter.get('user:1')).totalHits, 2);

  await limiter.decrement('user:1');
  assert.equal((await limiter.get('user:1')).totalHits, 1);

  await limiter.resetKey('user:1');
  assert.equal(await limiter.get('user:1'), undefined);
  assert.equal(redisStore.calls.length, 0, 'Redis is never touched while disabled');
  assert.equal(rateLimitStoreStatus().mode, 'memory');
});

test('with Redis two store instances share the same counter', async () => {
  enableRedis();
  resetRedis();

  const first = createRateLimitStore('shared');
  const second = createRateLimitStore('shared');
  first.init({ windowMs: 60_000 });
  second.init({ windowMs: 60_000 });

  assert.equal((await first.increment('user:42')).totalHits, 1);
  const secondHit = await second.increment('user:42');
  assert.equal(secondHit.totalHits, 2);
  assert.ok(secondHit.resetTime instanceof Date);

  const key = redisKey('ratelimit:shared:user:42');
  assert.equal(redisStore.strings.get(key), 2);
  assert.ok(redisStore.expiry.has(key), 'the first increment sets a TTL');

  assert.equal(rateLimitStoreStatus().mode, 'redis');
  assert.equal(rateLimitStoreStatus().shared, true);
});

test('Redis failure falls back to local counting and stops retrying for 30s', async () => {
  enableRedis();
  resetRedis();
  redisStore.failCommands.add('incr');

  const limiter = createRateLimitStore('fallback');
  limiter.init({ windowMs: 60_000 });
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  try {
    assert.equal((await limiter.increment('user:7')).totalHits, 1);
    assert.equal((await limiter.increment('user:7')).totalHits, 2);
    assert.equal(redisStore.count('incr'), 1, 'the degraded window is respected');
    assert.equal(logged.length, 1, 'one warning, not one per request');
  } finally {
    console.error = originalError;
  }
});

test('resetKey clears the shared Redis key as well as the local one', async () => {
  enableRedis();
  resetRedis();
  const limiter = createRateLimitStore('reset');
  limiter.init({ windowMs: 60_000 });
  await limiter.increment('user:9');

  const key = redisKey('ratelimit:reset:user:9');
  assert.ok(redisStore.strings.has(key));

  await limiter.resetKey('user:9');
  assert.equal(redisStore.strings.has(key), false);
});
