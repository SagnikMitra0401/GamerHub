const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeInviteOptions,
  inviteStatus,
  newInviteCode,
  MAX_USES_LIMIT
} = require('../utils/invites');

const HOUR = 3_600_000;
const NOW = Date.parse('2026-11-09T12:00:00.000Z');

test('invite options default to a permanent, unlimited member link', () => {
  const { ok, value } = normalizeInviteOptions({});
  assert.equal(ok, true);
  assert.deepEqual(value, { role: 'member', maxUses: 0, expiresInDays: 0, requiresApproval: false });
});

test('approval can be required per link', () => {
  assert.equal(normalizeInviteOptions({ requiresApproval: true }).value.requiresApproval, true);
  assert.equal(normalizeInviteOptions({ requiresApproval: 'true' }).value.requiresApproval, true);
  assert.equal(normalizeInviteOptions({ requiresApproval: false }).value.requiresApproval, false);
  assert.equal(normalizeInviteOptions({}).value.requiresApproval, false);
});

test('an invite can never grant a moderator or admin role', () => {
  const { ok, errors } = normalizeInviteOptions({ role: 'admin' });
  assert.equal(ok, false);
  assert.match(errors[0], /member role/);
});

test('use limits and expiry stay inside their bounds', () => {
  assert.equal(normalizeInviteOptions({ maxUses: -1 }).ok, false);
  assert.equal(normalizeInviteOptions({ maxUses: MAX_USES_LIMIT + 1 }).ok, false);
  assert.equal(normalizeInviteOptions({ maxUses: 1.5 }).ok, false);
  assert.equal(normalizeInviteOptions({ expiresInDays: 31 }).ok, false);
  assert.equal(normalizeInviteOptions({ expiresInDays: -1 }).ok, false);

  const { ok, value } = normalizeInviteOptions({ maxUses: 5, expiresInDays: 7 });
  assert.equal(ok, true);
  assert.equal(value.maxUses, 5);
  assert.equal(value.expiresInDays, 7);
});

test('status reports active, expired, used up, revoked and missing links', () => {
  assert.equal(inviteStatus(null, NOW), 'missing');
  assert.equal(inviteStatus({}, NOW), 'active');
  assert.equal(
    inviteStatus({ expiresAt: new Date(NOW - HOUR).toISOString() }, NOW),
    'expired'
  );
  assert.equal(
    inviteStatus({ expiresAt: new Date(NOW + HOUR).toISOString() }, NOW),
    'active'
  );
  assert.equal(inviteStatus({ maxUses: 2, uses: 2 }, NOW), 'used_up');
  assert.equal(inviteStatus({ maxUses: 2, uses: 1 }, NOW), 'active');
  assert.equal(inviteStatus({ maxUses: 0, uses: 999 }, NOW), 'active');
  assert.equal(inviteStatus({ revokedAt: new Date(NOW).toISOString() }, NOW), 'revoked');
});

test('codes are URL-safe, long enough to be unguessable, and unique', () => {
  const codes = new Set(Array.from({ length: 200 }, () => newInviteCode()));
  assert.equal(codes.size, 200);
  for (const code of codes) {
    assert.match(code, /^[A-Za-z0-9_-]{12}$/);
  }
});
