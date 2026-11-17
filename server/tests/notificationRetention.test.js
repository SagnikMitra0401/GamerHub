'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DAY_MS,
  NOTIFICATION_TTL_DAYS,
  NOTIFICATION_TTL_MS,
  isImportantNotification,
  retentionAtFor
} = require('../utils/notificationRetention');

test('ordinary notifications expire after 15 days', () => {
  assert.equal(NOTIFICATION_TTL_DAYS, 15);
  assert.equal(NOTIFICATION_TTL_MS, 15 * DAY_MS);
  assert.equal(isImportantNotification({ metadata: { kind: 'comment' } }), false);
  assert.equal(isImportantNotification({ metadata: { kind: 'follow' } }), false);
  assert.equal(isImportantNotification({ metadata: { kind: 'like_milestone' } }), false);
  assert.equal(isImportantNotification({ metadata: { kind: 'dm_digest' } }), false);
  assert.equal(isImportantNotification({ metadata: { kind: 'lfg_request' } }), false);
});

test('invitations, follow requests and system notices are durable', () => {
  for (const kind of [
    'invitation',
    'invitation_accepted',
    'business_team_invite',
    'follow_request',
    'system_notice',
    'account_security',
    'security_alert',
    'community_join_request'
  ]) {
    assert.equal(isImportantNotification({ metadata: { kind } }), true, kind);
  }
});

test('an explicit important marker works for future notice kinds', () => {
  assert.equal(isImportantNotification({ metadata: { important: true } }), true);
  assert.equal(isImportantNotification({ metadata: { retention: 'important' } }), true);
  assert.equal(isImportantNotification({ metadata: { retention: 'normal' } }), false);
});

test('retentionAtFor returns now + 15 days for ordinary pings and null for durable ones', () => {
  const now = new Date('2026-11-15T12:00:00.000Z');
  assert.equal(
    retentionAtFor({ metadata: { kind: 'comment' } }, { now }).toISOString(),
    '2026-11-30T12:00:00.000Z'
  );
  assert.equal(retentionAtFor({ metadata: { kind: 'follow_request' } }, { now }), null);
  assert.equal(retentionAtFor({ metadata: { important: true } }, { now }), null);
});
