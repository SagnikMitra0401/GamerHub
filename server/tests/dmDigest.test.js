const test = require('node:test');
const assert = require('node:assert/strict');

const { digestDue, buildDigest, digestPeriodKey } = require('../jobs/dmDigest');
const { defaultDmSettings, normalizeDmSettings } = require('../utils/dmPolicy');

function settings(patch = {}) {
  return normalizeDmSettings({ ...defaultDmSettings(), ...patch });
}

test('daily digest starts at 08:00 local time', () => {
  const daily = settings({ digest: 'daily', quietHours: { enabled: false, timezone: 'UTC' } });
  assert.equal(digestDue(daily, new Date('2026-11-07T07:59:00Z')), false);
  assert.equal(digestDue(daily, new Date('2026-11-07T08:00:00Z')), true);
});

test('weekly digest waits for Monday', () => {
  const weekly = settings({ digest: 'weekly', quietHours: { enabled: false, timezone: 'UTC' } });
  assert.equal(digestDue(weekly, new Date('2026-11-08T09:00:00Z')), false);
  assert.equal(digestDue(weekly, new Date('2026-11-09T09:00:00Z')), true);
});

test('digest is skipped during quiet hours and when off', () => {
  const quiet = settings({
    digest: 'daily',
    quietHours: { enabled: true, start: '07:00', end: '10:00', timezone: 'UTC' }
  });
  assert.equal(digestDue(quiet, new Date('2026-11-07T09:00:00Z')), false);
  assert.equal(digestDue(settings({ digest: 'off' }), new Date('2026-11-07T09:00:00Z')), false);
});

test('digest copy distinguishes requests from unread messages', () => {
  assert.deepEqual(buildDigest({ requests: 2, unread: 1 }), {
    title: 'Your message digest',
    message: '2 requests waiting · 1 unread message',
    actionUrl: '/messages?folder=requests'
  });
  assert.deepEqual(buildDigest({ requests: 0, unread: 3 }), {
    title: 'Your message digest',
    message: '3 unread messages',
    actionUrl: '/messages'
  });
  assert.equal(buildDigest({ requests: 0, unread: 0 }), null);
});

test('period key follows the recipient timezone date', () => {
  const timezone = settings({ quietHours: { enabled: false, timezone: 'Pacific/Kiritimati' } });
  assert.equal(digestPeriodKey(timezone, new Date('2026-11-07T12:00:00Z')), '2026-11-08');
});
