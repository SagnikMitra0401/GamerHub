/**
 * Temporary squad-chat clock.
 *
 * The expiry rule is enforced in three places (REST, socket, retention sweep);
 * these tests pin the rule itself, including the boundary that matters most:
 * exactly `expiresAt` is already expired, even with the cron stopped.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  CHAT_TTL_MS,
  CHAT_TTL_DAYS,
  expiryFrom,
  msRemaining,
  isExpired,
  isOpen,
  isChatMember,
  canRefresh,
  formatRemaining
} = require('../utils/squadLifecycle');

const NOW = new Date('2026-11-01T12:00:00.000Z');
const owner = '507f1f77bcf86cd799439011';
const member = '507f1f77bcf86cd799439022';
const outsider = '507f1f77bcf86cd799439033';

const chat = (extra = {}) => ({
  _id: '507f1f77bcf86cd799439099',
  ownerUserId: owner,
  memberIds: [owner, member],
  state: 'active',
  expiresAt: new Date(NOW.getTime() + CHAT_TTL_MS),
  ...extra
});

test('a fresh chat expires 15 days out', () => {
  assert.equal(CHAT_TTL_DAYS, 15);
  assert.equal(expiryFrom(NOW).getTime() - NOW.getTime(), CHAT_TTL_MS);
  assert.equal(CHAT_TTL_MS, 15 * 24 * 60 * 60 * 1000);
});

test('the boundary instant is already expired', () => {
  const expiring = chat({ expiresAt: new Date(NOW) });
  assert.equal(isExpired(expiring, NOW), true, 'expiresAt <= now must be expired');
  assert.equal(isExpired(chat(), NOW), false);
  assert.equal(msRemaining(expiring, NOW), 0);
});

test('a closed chat is closed, not expired', () => {
  const closed = chat({ state: 'closed' });
  assert.equal(isExpired(closed, NOW), false);
  assert.equal(isOpen(closed, NOW), false);

  const ended = chat({ state: 'expired' });
  assert.equal(isOpen(ended, NOW), false);
});

test('only the owner may refresh, and only while alive', () => {
  assert.deepEqual(canRefresh(chat(), owner, NOW), { ok: true });

  const asMember = canRefresh(chat(), member, NOW);
  assert.equal(asMember.ok, false);
  assert.equal(asMember.code, 'FORBIDDEN');

  const expired = canRefresh(chat({ expiresAt: new Date(NOW.getTime() - 1) }), owner, NOW);
  assert.equal(expired.code, 'EXPIRED');

  assert.equal(canRefresh(chat({ state: 'closed' }), owner, NOW).code, 'CLOSED');
  assert.equal(canRefresh(null, owner, NOW).code, 'NOT_FOUND');
});

test('membership covers the owner and invited members only', () => {
  const value = chat();
  assert.equal(isChatMember(value, owner), true);
  assert.equal(isChatMember(value, member), true);
  assert.equal(isChatMember(value, outsider), false);
  assert.equal(isChatMember(value, null), false);
});

test('remaining time is rendered in days, hours and minutes', () => {
  assert.equal(formatRemaining(chat(), NOW), '15d 0h left');
  assert.equal(
    formatRemaining(chat({ expiresAt: new Date(NOW.getTime() + 2 * 3_600_000) }), NOW),
    '2h left'
  );
  assert.equal(
    formatRemaining(chat({ expiresAt: new Date(NOW.getTime() + 5 * 60_000) }), NOW),
    '5m left'
  );
  assert.equal(formatRemaining(chat({ expiresAt: NOW }), NOW), 'expired');
});
