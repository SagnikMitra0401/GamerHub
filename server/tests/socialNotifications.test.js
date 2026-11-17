'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LIKE_MILESTONES,
  likeMilestoneFor
} = require('../utils/socialNotifications');

test('like milestones are the expected thresholds', () => {
  assert.deepEqual([...LIKE_MILESTONES], [1, 5, 10, 25, 50, 100]);
});

test('likeMilestoneFor only matches a threshold', () => {
  for (const value of LIKE_MILESTONES) {
    assert.equal(likeMilestoneFor(value), value);
    assert.equal(likeMilestoneFor(String(value)), value);
  }
  for (const value of [0, 2, 4, 6, 9, 11, 24, 51, 99, 101, -1, null, undefined, 'nope']) {
    assert.equal(likeMilestoneFor(value), null, String(value));
  }
});
