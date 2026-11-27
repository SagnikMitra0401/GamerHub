const test = require('node:test');
const assert = require('node:assert/strict');

const { routeTable, readFixture, diff } = require('../../scripts/route-snapshot');

test('the live route table matches the recorded fixture', () => {
  const live = routeTable();
  const { added, removed } = diff(live, readFixture());
  assert.deepEqual(added, [], `routes added without a fixture update: ${added.join(', ')}`);
  assert.deepEqual(removed, [], `routes disappeared: ${removed.join(', ')}`);
});

test('the fixture covers the whole public surface', () => {
  const live = routeTable();
  assert.ok(live.length >= 200, `only ${live.length} routes were found`);
  assert.equal(new Set(live).size, live.length, 'the table contains duplicates');
});
