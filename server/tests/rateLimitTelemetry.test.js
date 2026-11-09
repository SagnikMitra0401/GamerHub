const test = require('node:test');
const assert = require('node:assert/strict');

const { snapshot, resetMetrics, recordRateLimit } = require('../utils/metrics');

test('rate-limit hits appear in the admin snapshot', () => {
  resetMetrics();
  recordRateLimit('dm-write');
  recordRateLimit('dm-write');
  recordRateLimit('search');
  const traffic = snapshot();
  assert.deepEqual(traffic.rateLimits, [
    { name: 'dm-write', hits: 2 },
    { name: 'search', hits: 1 }
  ]);
});

test('metrics reset clears rate-limit counters', () => {
  recordRateLimit('admin');
  resetMetrics();
  assert.deepEqual(snapshot().rateLimits, []);
});
