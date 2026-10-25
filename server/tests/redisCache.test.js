/**
 * Unit tests for the two-tier cache (L1 memory, L2 Upstash).
 *
 * These cover the part that no e2e suite can reach without breaking a real
 * Upstash account: what happens when Redis errors, how the 30-second degrade
 * window behaves, that only successful loads are cached, and that concurrent
 * misses collapse into one load.
 */
const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const { installFakeRedis, enableRedis, disableRedis, store } = require('./helpers/fakeRedis');

const redisStore = installFakeRedis();

const cache = require('../utils/redisCache');
const { resetRedis, redisKey } = require('../config/redis');

const KEY = 'gamecatalog:all';
const PREFIXED = redisKey(KEY);

let logged = [];
const realConsoleError = console.error;

before(() => { console.error = (...args) => logged.push(args.join(' ')); });
after(() => { console.error = realConsoleError; });

beforeEach(() => {
  redisStore.reset();
  cache.resetCacheLayer();
  resetRedis();
  disableRedis();
  logged = [];
});

// ── Redis switched off ─────────────────────────────────────────────────────

test('without Redis everything still works, from memory alone', async () => {
  await cache.cacheSet(KEY, { games: 1 });

  assert.equal(redisStore.calls.length, 0, 'the client is never built');
  assert.deepEqual(await cache.cacheGet(KEY), { games: 1 });
});

test('a read-through only calls the loader once', async () => {
  let loads = 0;
  const loader = async () => { loads += 1; return ['a', 'b']; };

  assert.deepEqual(await cache.cacheWrap(KEY, loader), ['a', 'b']);
  assert.deepEqual(await cache.cacheWrap(KEY, loader), ['a', 'b']);
  assert.equal(loads, 1);
});

test('cacheDelete drops the memory tier too', async () => {
  await cache.cacheSet(KEY, 'stale');
  await cache.cacheDelete(KEY);
  assert.equal(await cache.cacheGet(KEY), undefined);
});

// ── Redis switched on ──────────────────────────────────────────────────────

test('a write lands in both tiers with the requested TTL', async () => {
  enableRedis();
  await cache.cacheSet(KEY, { games: 2 }, 90);

  assert.deepEqual(redisStore.strings.get(PREFIXED), { games: 2 });
  assert.equal(redisStore.ttl.get(PREFIXED), 90, 'Upstash EX is set from the TTL');
  assert.deepEqual(await cache.cacheGet(KEY), { games: 2 });
});

test('a cold L1 is served by L2 without calling the loader', async () => {
  enableRedis();
  await cache.cacheSet(KEY, 'warm');

  cache.resetCacheLayer();          // simulate a fresh process; Redis keeps the value
  let loads = 0;
  const value = await cache.cacheWrap(KEY, async () => { loads += 1; return 'loaded'; });

  assert.equal(value, 'warm');
  assert.equal(loads, 0);
});

test('the default TTL is applied when none is given', async () => {
  enableRedis();
  await cache.cacheSet(KEY, 'value');
  assert.equal(redisStore.ttl.get(PREFIXED), cache.DEFAULT_TTL_SECONDS);
});

test('cacheDelete clears the Redis key as well', async () => {
  enableRedis();
  await cache.cacheSet(KEY, 'value');
  await cache.cacheDelete(KEY);

  assert.equal(redisStore.strings.has(PREFIXED), false);
  assert.equal(await cache.cacheGet(KEY), undefined);
});

// ── Degrade window ─────────────────────────────────────────────────────────

test('a Redis error degrades to memory and stops calling Redis', async () => {
  enableRedis();
  redisStore.failCommands.add('get');

  assert.equal(await cache.cacheGet(KEY), undefined, 'a miss, not a thrown error');
  assert.equal(redisStore.count('get'), 1);

  await cache.cacheSet(KEY, 'from-memory');
  assert.equal(await cache.cacheGet(KEY), 'from-memory');
  assert.equal(redisStore.count('get'), 1, 'inside the window Redis is not tried');
  assert.equal(logged.length, 1, 'one warning, not one per request');
});

test('the cache recovers once the window elapses', async () => {
  enableRedis();
  mock.timers.enable({ apis: ['Date'] });
  try {
    redisStore.failCommands.add('get');
    await cache.cacheGet(KEY);
    assert.equal(redisStore.count('get'), 1);

    redisStore.failCommands.clear();
    await cache.cacheGet(KEY);
    assert.equal(redisStore.count('get'), 1, 'still degraded');

    mock.timers.tick(31_000);
    await cache.cacheGet(KEY);
    assert.equal(redisStore.count('get'), 2, 'Redis is used again after 30 s');
  } finally {
    mock.timers.reset();
  }
});

test('a write that fails in Redis is still served from memory', async () => {
  enableRedis();
  redisStore.failCommands.add('set');

  await cache.cacheSet(KEY, 'kept');

  assert.equal(await cache.cacheGet(KEY), 'kept');
  assert.equal(redisStore.strings.has(PREFIXED), false);
});

// ── Loader semantics ───────────────────────────────────────────────────────

test('concurrent misses collapse into a single load', async () => {
  enableRedis();
  let loads = 0;
  const loader = async () => {
    loads += 1;
    await new Promise(resolve => setTimeout(resolve, 5));
    return 'once';
  };

  const results = await Promise.all([
    cache.cacheWrap(KEY, loader),
    cache.cacheWrap(KEY, loader),
    cache.cacheWrap(KEY, loader)
  ]);

  assert.deepEqual(results, ['once', 'once', 'once']);
  assert.equal(loads, 1);
});

test('a failed load is never cached', async () => {
  enableRedis();
  let attempts = 0;
  const loader = async () => {
    attempts += 1;
    throw new Error('upstream exploded');
  };

  await assert.rejects(cache.cacheWrap(KEY, loader), /upstream exploded/);

  assert.equal(redisStore.strings.has(PREFIXED), false);
  assert.equal(await cache.cacheGet(KEY), undefined, 'nothing was stored in L1 either');

  await assert.rejects(cache.cacheWrap(KEY, loader), /upstream exploded/);
  assert.equal(attempts, 2, 'the next request tries again instead of caching the failure');
});

test('a null result is treated as a miss, not a cache hit', async () => {
  // Characterisation: this is what keeps `cacheWrap` honest when a loader has
  // nothing to return — it will be asked again rather than serving a stale null.
  enableRedis();
  let loads = 0;
  const loader = async () => { loads += 1; return null; };

  await cache.cacheWrap(KEY, loader);
  await cache.cacheWrap(KEY, loader);

  assert.equal(loads, 2);
});
