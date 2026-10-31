/**
 * Account settings hub rules.
 *
 * Handle validation, frozen-account policy and ownership succession are pure
 * decisions, so they are tested as a matrix here rather than through HTTP.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeUsername,
  usernameFilter,
  USERNAME_MAX
} = require('../utils/username');
const { canParticipate, accountGate, canInvite } = require('../utils/privacy');
const {
  orderSuccessors,
  chooseCommunitySuccessor,
  chooseSquadSuccessor
} = require('../utils/succession');

const id = (suffix) => `507f1f77bcf86cd7994390${suffix}`;
const joined = (day) => new Date(`2026-10-${String(day).padStart(2, '0')}T12:00:00Z`);

// ── Username rules ──────────────────────────────────────────────────────────

test('a valid handle is trimmed and kept as typed', () => {
  assert.deepEqual(normalizeUsername('  Night_Owl  '), { ok: true, value: 'Night_Owl' });
});

test('short, long and malformed handles are refused with a reason', () => {
  for (const input of ['ab', 'a'.repeat(USERNAME_MAX + 1), 'no spaces', 'dash-name', 'dot.name', 'emoji_🎮']) {
    const result = normalizeUsername(input);
    assert.equal(result.ok, false, `${input} should be refused`);
    assert.ok(result.reason.length > 10);
  }
});

test('non-text handles are refused', () => {
  for (const input of [undefined, null, 42, {}, ['name']]) {
    assert.equal(normalizeUsername(input).ok, false);
  }
});

test('platform names cannot be claimed as a handle', () => {
  for (const input of ['admin', 'ADMIN', 'moderator', 'GamerHub', 'support']) {
    assert.equal(normalizeUsername(input).ok, false, `${input} should be reserved`);
  }
});

test('the lookup is case-insensitive and can ignore the caller', () => {
  const filter = usernameFilter('Alice', '507f1f77bcf86cd799439011');
  assert.equal(filter.username.$options, 'i');
  assert.equal(filter.username.$regex, '^Alice$');
  assert.equal(filter._id.$ne, '507f1f77bcf86cd799439011');

  assert.equal(usernameFilter('Alice')._id, undefined);
});

// ── Frozen account policy ───────────────────────────────────────────────────

test('an active account may participate', () => {
  assert.deepEqual(canParticipate({ status: 'active' }), { ok: true });
});

test('a frozen account may sign in but not participate', () => {
  assert.equal(accountGate({ status: 'frozen' }).ok, true, 'sign-in must work to unfreeze');

  const gate = canParticipate({ status: 'frozen' });
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'ACCOUNT_FROZEN');
  assert.match(gate.reason, /Settings/);
});

test('suspended and deleted accounts cannot participate', () => {
  assert.equal(canParticipate({ status: 'suspended' }).code, 'ACCOUNT_SUSPENDED');
  assert.equal(canParticipate({ status: 'deleted' }).code, 'ACCOUNT_DELETED');
});

test('a frozen account is not an invitable recipient, and cannot invite', () => {
  const inviter = { _id: id('11'), status: 'active', blockedUsers: [] };
  const frozenRecipient = { _id: id('22'), status: 'frozen', blockedUsers: [] };
  const frozenInviter = { _id: id('33'), status: 'frozen', blockedUsers: [] };
  const activeRecipient = { _id: id('44'), status: 'active', blockedUsers: [] };

  assert.equal(canInvite({ targetType: 'squad', recipient: frozenRecipient, inviter }).code, 'UNAVAILABLE');
  assert.equal(canInvite({ targetType: 'squad', recipient: activeRecipient, inviter: frozenInviter }).code, 'ACCOUNT_FROZEN');
  assert.equal(canInvite({ targetType: 'squad', recipient: activeRecipient, inviter }).ok, true);
});

// ── Succession ──────────────────────────────────────────────────────────────

const community = (members) => ({ _id: id('99'), ownerId: id('11'), members });

test('an admin inherits before a longer-serving moderator or member', () => {
  const successor = chooseCommunitySuccessor(community([
    { userId: id('11'), role: 'owner', joinedAt: joined(1) },
    { userId: id('22'), role: 'member', joinedAt: joined(2) },
    { userId: id('33'), role: 'moderator', joinedAt: joined(3) },
    { userId: id('44'), role: 'admin', joinedAt: joined(9) }
  ]), id('11'));

  assert.equal(successor.userId, id('44'));
  assert.equal(successor.role, 'admin');
});

test('the earliest-joined admin wins when authority is equal', () => {
  const successor = chooseCommunitySuccessor(community([
    { userId: id('11'), role: 'owner', joinedAt: joined(1) },
    { userId: id('22'), role: 'admin', joinedAt: joined(5) },
    { userId: id('33'), role: 'admin', joinedAt: joined(2) }
  ]), id('11'));

  assert.equal(successor.userId, id('33'));
});

test('a veteran member inherits when no staff remain', () => {
  const successor = chooseCommunitySuccessor(community([
    { userId: id('11'), role: 'owner', joinedAt: joined(1) },
    { userId: id('22'), role: 'member', joinedAt: joined(7) },
    { userId: id('33'), role: 'member', joinedAt: joined(4) }
  ]), id('11'));

  assert.equal(successor.userId, id('33'));
});

test('the departing owner is never chosen, and an empty server has no successor', () => {
  assert.equal(chooseCommunitySuccessor(community([
    { userId: id('11'), role: 'owner', joinedAt: joined(1) }
  ]), id('11')), null);

  assert.equal(chooseCommunitySuccessor(community([]), id('11')), null);
});

test('tied members fall back to a stable id order', () => {
  const ordered = orderSuccessors([
    { userId: id('33'), role: 'member', joinedAt: joined(2) },
    { userId: id('22'), role: 'member', joinedAt: joined(2) }
  ], id('11'));
  assert.deepEqual(ordered.map((entry) => entry.userId), [id('22'), id('33')]);
});

test('squad leadership goes to the earliest member and skips the leader', () => {
  const party = {
    _id: id('98'),
    leaderId: id('11'),
    members: [
      { userId: id('11'), role: 'leader', joinedAt: joined(1) },
      { userId: id('44'), role: 'member', joinedAt: joined(6) },
      { userId: id('22'), role: 'member', joinedAt: joined(3) }
    ]
  };

  assert.equal(chooseSquadSuccessor(party, id('11')).userId, id('22'));
  assert.equal(chooseSquadSuccessor(party, id('22')).userId, id('11'), 'the current leader is eligible while not departing');
});

test('a squad with only the departing leader has no successor', () => {
  const party = {
    leaderId: id('11'),
    members: [{ userId: id('11'), role: 'leader', joinedAt: joined(1) }]
  };
  assert.equal(chooseSquadSuccessor(party, id('11')), null);
});
