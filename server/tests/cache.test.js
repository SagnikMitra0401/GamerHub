const test = require('node:test');
const assert = require('node:assert/strict');

const { createTtlCache } = require('../utils/cache');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('values are cached until their TTL elapses', async () => {
  const cache = createTtlCache({ ttlMs: 20 });
  let calls = 0;
  const loader = async () => { calls += 1; return calls; };

  assert.equal(await cache.wrap('k', loader), 1);
  assert.equal(await cache.wrap('k', loader), 1);
  assert.equal(calls, 1);

  await sleep(30);
  assert.equal(await cache.wrap('k', loader), 2);
  assert.equal(calls, 2);
});

test('concurrent misses collapse into a single upstream call', async () => {
  const cache = createTtlCache({ ttlMs: 1000 });
  let calls = 0;
  const loader = async () => {
    calls += 1;
    await sleep(10);
    return 'value';
  };

  const [a, b, c] = await Promise.all([
    cache.wrap('same', loader),
    cache.wrap('same', loader),
    cache.wrap('same', loader)
  ]);

  assert.equal(calls, 1);
  assert.deepEqual([a, b, c], ['value', 'value', 'value']);
});

test('a failing loader is not cached', async () => {
  const cache = createTtlCache({ ttlMs: 1000 });
  let calls = 0;

  await assert.rejects(
    cache.wrap('boom', async () => { calls += 1; throw new Error('upstream down'); })
  );
  assert.equal(cache.get('boom'), undefined);

  const value = await cache.wrap('boom', async () => { calls += 1; return 'recovered'; });
  assert.equal(value, 'recovered');
  assert.equal(calls, 2);
});

test('maxEntries evicts the oldest key', () => {
  const cache = createTtlCache({ ttlMs: 1000, maxEntries: 2 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);

  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('b'), 2);
  assert.equal(cache.get('c'), 3);
});
