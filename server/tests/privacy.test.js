/**
 * Consent, blocking and erasure policy.
 *
 * These are the rules that decide whether somebody else may put you into a
 * squad or a server, and what "delete my account" actually removes — so they
 * are tested as a matrix rather than through HTTP.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  canInvite,
  isBlockedBetween,
  containsId,
  sanitizePrivacyPatch,
  accountGate,
  isDiscoverable,
  erasurePatch
} = require('../utils/privacy');

const id = (suffix) => `507f1f77bcf86cd7994390${suffix}`;

const user = (suffix, extra = {}) => ({
  _id: id(suffix),
  status: 'active',
  privacySettings: {
    allowSquadInvites: 'anyone',
    allowServerInvites: 'anyone',
    allowDirectMessages: 'mutual_follows',
    discoverableInSearch: true,
    showActivityStatus: true
  },
  blockedUsers: [],
  ...extra
});

const inviter = user('11');

test('anyone may be invited when the setting is anyone', () => {
  const result = canInvite({ targetType: 'squad', recipient: user('22'), inviter });
  assert.deepEqual(result, { ok: true });
});

test('a recipient who accepts nobody cannot be invited', () => {
  const recipient = user('22', { privacySettings: { allowSquadInvites: 'none', allowServerInvites: 'anyone' } });
  const squad = canInvite({ targetType: 'squad', recipient, inviter });
  assert.equal(squad.ok, false);
  assert.equal(squad.code, 'PRIVACY');
  assert.match(squad.reason, /squad/);

  const server = canInvite({ targetType: 'community_server', recipient, inviter });
  assert.equal(server.ok, true, 'server invites are governed by their own setting');
});

test('followers-only requires the inviter to follow the recipient', () => {
  const recipient = user('22', { privacySettings: { allowSquadInvites: 'followers' } });

  const stranger = canInvite({ targetType: 'squad', recipient, inviter, inviterFollowsRecipient: false });
  assert.equal(stranger.ok, false);
  assert.equal(stranger.code, 'PRIVACY');

  const follower = canInvite({ targetType: 'squad', recipient, inviter, inviterFollowsRecipient: true });
  assert.equal(follower.ok, true);
});

test('blocking hides the reason and works in both directions', () => {
  const blockedByRecipient = user('22', { blockedUsers: [inviter._id] });
  const result = canInvite({ targetType: 'squad', recipient: blockedByRecipient, inviter });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BLOCKED');
  assert.equal(result.reason, 'This player cannot be invited.');
  assert.doesNotMatch(result.reason, /block/i, 'must not reveal that a block exists');

  const blockedByInviter = user('22');
  const inviterWhoBlocked = user('11', { blockedUsers: [blockedByInviter._id] });
  assert.equal(isBlockedBetween(inviterWhoBlocked, blockedByInviter), true);
  assert.equal(
    canInvite({ targetType: 'squad', recipient: blockedByInviter, inviter: inviterWhoBlocked }).code,
    'BLOCKED'
  );
});

test('deleted and suspended accounts cannot be invited', () => {
  for (const status of ['deleted', 'deletion_pending', 'suspended']) {
    const result = canInvite({ targetType: 'squad', recipient: user('22', { status }), inviter });
    assert.equal(result.ok, false, status);
    assert.equal(result.code, 'UNAVAILABLE');
  }
});

test('a self invite is refused', () => {
  assert.equal(
    canInvite({ targetType: 'squad', recipient: user('11'), inviter }).code,
    'SELF_INVITE'
  );
});

test('containsId matches ids and populated documents', () => {
  assert.equal(containsId([id('22')], id('22')), true);
  assert.equal(containsId([{ _id: id('22') }], id('22')), true);
  assert.equal(containsId(null, id('22')), false);
  assert.equal(containsId([id('33')], id('22')), false);
});

test('privacy patch accepts known fields and rejects everything else', () => {
  const ok = sanitizePrivacyPatch({ allowSquadInvites: 'followers', showActivityStatus: false });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { allowSquadInvites: 'followers', showActivityStatus: false });

  const badEnum = sanitizePrivacyPatch({ allowSquadInvites: 'everyone-i-know' });
  assert.equal(badEnum.ok, false);
  assert.match(badEnum.errors[0], /allowSquadInvites/);

  const badType = sanitizePrivacyPatch({ discoverableInSearch: 'yes' });
  assert.equal(badType.ok, false);

  const unknown = sanitizePrivacyPatch({ allowEverything: true });
  assert.equal(unknown.ok, false);
  assert.match(unknown.errors[0], /No updatable/);

  assert.equal(sanitizePrivacyPatch({}).ok, false);
});

test('account gate blocks deleted and suspended accounts only', () => {
  assert.deepEqual(accountGate({ status: 'active' }), { ok: true });
  assert.equal(accountGate(null).status, 401);
  assert.equal(accountGate({ status: 'deleted' }).status, 401);
  assert.equal(accountGate({ status: 'suspended' }).status, 403);
  assert.equal(accountGate({ status: 'deletion_pending' }).ok, true);
  assert.equal(accountGate({ status: 'restricted' }).ok, true);
});

test('discoverability respects the opt-out for everyone but the owner', () => {
  const hidden = user('22', { privacySettings: { discoverableInSearch: false } });
  assert.equal(isDiscoverable(hidden, inviter._id), false);
  assert.equal(isDiscoverable(hidden, hidden._id), true);
  assert.equal(isDiscoverable(user('33'), inviter._id), true);
});

test('erasure anonymises identity and revokes every session', () => {
  const patch = erasurePatch({ _id: id('aa'), sessionVersion: 3 }).$set;

  assert.match(patch.username, /^deleted_/);
  assert.match(patch.email, /@deleted\.invalid$/);
  assert.equal(patch.status, 'deleted');
  assert.equal(patch.sessionVersion, 4);
  assert.deepEqual(patch.authIdentities, []);
  assert.deepEqual(patch.blockedUsers, []);
  assert.deepEqual(patch.followers, []);
  assert.equal(patch.bio, '');
  assert.equal(patch['gamerPassport.activeGames'].length, 0);
  assert.equal(patch['privacySettings.discoverableInSearch'], false);
  assert.doesNotMatch(patch.passwordHash, /^\$2[aby]\$/, 'must not look like a usable bcrypt hash');
});

test('erasure usernames stay inside the 20-character limit', () => {
  const patch = erasurePatch({ _id: '507f1f77bcf86cd799439011', sessionVersion: 0 }).$set;
  assert.ok(patch.username.length <= 20, patch.username);
  assert.ok(!/\s/.test(patch.username));
});
