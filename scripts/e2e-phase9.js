/**
 * Phase 9 end-to-end verification — account & settings hub.
 *
 * Runs against a THROWAWAY database on the same cluster:
 *   node scripts/e2e-phase9.js
 *
 * Covers the settings surface that cannot be proven by pure functions:
 * handle changes and case-insensitive uniqueness, feed-affinity reset,
 * frozen-account visibility and participation (REST and socket), the Google
 * link fail-closed branches, session revocation, succession preview, and
 * immediate deletion with ownership transfer + a reusable email.
 */
require('dotenv').config();
const http = require('http');
const assert = require('assert/strict');
const mongoose = require('mongoose');

const E2E_DB = `gamerhub_e2e9_${Date.now().toString(36)}`;

function tempMongoUri() {
  const url = new URL(process.env.MONGO_URI);
  url.pathname = `/${E2E_DB}`;
  return url.toString();
}

process.env.MONGO_URI = tempMongoUri();
process.env.NODE_ENV = 'test';
process.env.CLIENT_URL = 'http://localhost:3000';
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.USERNAME_RATE_LIMIT_MAX = '1000';
process.env.ACCOUNT_CONFIRM_RATE_LIMIT_MAX = '1000';
process.env.FEED_RESET_RATE_LIMIT_MAX = '1000';
process.env.EXPORT_RATE_LIMIT_MAX = '50';
process.env.DISABLE_RETENTION_WORKER = '1';

const connectDB = require('../server/config/db');
const app = require('../server/app');
const { initSocket } = require('../server/config/socket');
const { closeDomainConnections } = require('../server/config/connections');

const User = require('../server/models/User');
const Post = require('../server/models/Post');
const Community = require('../server/models/Community');
const Party = require('../server/models/Party');
const SquadChat = require('../server/models/SquadChat');

const { api, check, connectSocket, registerUser, report, setBase, waitFor } = require('./lib/e2e-harness');

async function joinChannel(socket, channelId) {
  const joined = waitFor(socket, 'joined_channel', (payload) => String(payload?.channelId) === String(channelId));
  socket.emit('join_channel', { channelId });
  const result = await joined;
  assert.ok(result, 'socket did not join the channel');
  return result;
}

async function sendMessage(socket, channelId, text) {
  const arrived = waitFor(socket, 'new_message', (payload) => payload?.text === text);
  socket.emit('send_message', { channelId, text });
  const message = await arrived;
  assert.ok(message, `message did not arrive: ${text}`);
  return message;
}

async function run() {
  await connectDB();
  console.log(`Using throwaway database: ${E2E_DB}`);

  const server = http.createServer(app);
  initSocket(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  setBase(`http://127.0.0.1:${server.address().port}`);

  const alice = await registerUser('alice', { probeId: true });
  const bob = await registerUser('bob', { probeId: true });
  const carol = await registerUser('carol', { probeId: true });

  const sockets = {
    bob: await connectSocket(bob.token)
  };

  try {
    await scenarios({ alice, bob, carol, sockets });
  } finally {
    for (const socket of Object.values(sockets)) socket.disconnect();
    await mongoose.connection.dropDatabase().catch(() => {});
    await closeDomainConnections();
    await mongoose.disconnect();
    server.close();
  }

  const failed = report();
  if (failed.length) process.exit(1);
}

async function scenarios({ alice, bob, carol, sockets }) {
  // ── Community + channel used by the visibility and socket checks ──────────
  console.log('\n[community setup]');
  const created = await api('/api/communities', {
    method: 'POST',
    cookie: alice.cookie,
    body: { name: 'Settings HQ', description: 'phase 9 sandbox' }
  });
  check('the owner creates a server', () => assert.equal(created.status, 201, JSON.stringify(created.data)));

  const communityId = created.data._id;
  const communitySlug = created.data.slug;

  const joinedCommunity = await api(`/api/communities/${communityId}/join`, {
    method: 'POST',
    cookie: bob.cookie
  });
  check('a member joins the server', () => assert.equal(joinedCommunity.status, 200));

  // Bob must be the highest-ranked successor so the transfer target is unambiguous.
  await Community.updateOne(
    { _id: communityId, 'members.userId': bob.id },
    { $set: { 'members.$.role': 'admin' } }
  );

  const detail = await api(`/api/communities/${communitySlug}`, { cookie: bob.cookie });
  const channelId = detail.data?.channels?.[0]?._id;
  check('the default channel is visible to the member', () => assert.ok(channelId));


  await joinChannel(sockets.bob, channelId);
  await sendMessage(sockets.bob, channelId, 'pre-freeze message');

  // ── Username rules ────────────────────────────────────────────────────────
  console.log('\n[username]');
  const invalidHandle = await api('/api/account/username', {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { username: 'not a handle' }
  });
  check('a malformed handle is refused', () => assert.equal(invalidHandle.status, 400));

  const reservedHandle = await api('/api/account/username', {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { username: 'admin' }
  });
  check('a reserved handle is refused', () => assert.equal(reservedHandle.status, 400));

  const takenHandle = await api('/api/account/username', {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { username: 'BOB' }
  });
  check('a handle is unique regardless of case', () => assert.equal(takenHandle.status, 409));

  const renamed = await api('/api/account/username', {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { username: 'alice_prime' }
  });
  check('a valid unused handle is accepted', () => {
    assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
    assert.equal(renamed.data.username, 'alice_prime');
  });

  const meAfterRename = await api('/api/auth/me', { cookie: alice.cookie });
  check('the session reflects the new handle immediately', () => {
    assert.equal(meAfterRename.data.user.username, 'alice_prime');
    assert.equal(String(meAfterRename.data.user._id), String(alice.id));
  });

  const oldProfile = await api('/api/users/alice', { cookie: bob.cookie });
  check('the old profile URL no longer resolves', () => assert.equal(oldProfile.status, 404));

  const newProfile = await api('/api/users/alice_prime', { cookie: bob.cookie });
  check('the new profile URL resolves', () => assert.equal(newProfile.status, 200));

  const sameHandle = await api('/api/account/username', {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { username: 'alice_prime' }
  });
  check('re-submitting the current handle is a no-op error', () => assert.equal(sameHandle.status, 400));

  // ── Feed reset ────────────────────────────────────────────────────────────
  console.log('\n[feed reset]');
  const preferences = await api('/api/users/me/preferences', {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { favoriteGames: ['Valorant'], favoriteGenres: ['FPS'], platforms: ['PC'] }
  });
  check('affinities are stored', () => assert.equal(preferences.status, 200));

  const favourite = await api('/api/users/channels/favourite', {
    method: 'POST',
    cookie: alice.cookie,
    body: { channel: 'valorant' }
  });
  check('a favourite channel is stored', () => assert.equal(favourite.status, 200));

  const beforeReset = await api('/api/account', { cookie: alice.cookie });
  check('the account summary reports the three affinity counts', () => {
    assert.equal(beforeReset.status, 200);
    assert.equal(beforeReset.data.feedSignals.favoriteGames, 1);
    assert.equal(beforeReset.data.feedSignals.favoriteGenres, 1);
    assert.equal(beforeReset.data.feedSignals.favoriteChannels, 1);
  });

  const reset = await api('/api/account/feed-reset', { method: 'POST', cookie: alice.cookie });
  check('recommendations reset and report what was cleared', () => {
    assert.equal(reset.status, 200, JSON.stringify(reset.data));
    assert.deepEqual(reset.data.cleared, { favoriteGames: 1, favoriteGenres: 1, favoriteChannels: 1 });
    assert.deepEqual(reset.data.kept.platforms, ['PC'], 'platform preference is not a ranking signal');
  });

  const afterReset = await api('/api/account', { cookie: alice.cookie });
  check('the baseline is empty and the reset timestamp is recorded', () => {
    assert.equal(afterReset.data.feedSignals.favoriteGames, 0);
    assert.equal(afterReset.data.feedSignals.favoriteGenres, 0);
    assert.equal(afterReset.data.feedSignals.favoriteChannels, 0);
    assert.ok(afterReset.data.feedResetAt);
  });

  // ── Freeze: visibility + participation ────────────────────────────────────
  console.log('\n[freeze]');
  const post = await api('/api/posts', {
    method: 'POST',
    cookie: alice.cookie,
    body: { title: 'Freeze probe', content: 'This post should vanish while frozen.', tags: ['valorant'] }
  });
  check('a post is created before freezing', () => assert.equal(post.status, 201, JSON.stringify(post.data)));
  const postId = post.data._id;

  const visibleBefore = await api('/api/posts?limit=50', { cookie: bob.cookie });
  check('the post is in the feed before freezing', () => {
    assert.ok(visibleBefore.data.some((entry) => String(entry._id) === String(postId)));
  });

  const wrongFreeze = await api('/api/account/freeze', {
    method: 'POST',
    cookie: alice.cookie,
    body: { frozen: true, password: 'wrong-password' }
  });
  check('freezing with the wrong password is refused', () => assert.equal(wrongFreeze.status, 403));

  const frozen = await api('/api/account/freeze', {
    method: 'POST',
    cookie: alice.cookie,
    body: { frozen: true, password: 'password123' }
  });
  check('freezing with the password succeeds', () => {
    assert.equal(frozen.status, 200, JSON.stringify(frozen.data));
    assert.equal(frozen.data.status, 'frozen');
  });

  const hiddenProfile = await api('/api/users/alice_prime', { cookie: bob.cookie });
  check('a frozen profile is not found by another player', () => assert.equal(hiddenProfile.status, 404));

  const hiddenPost = await api(`/api/posts/${postId}`, { cookie: bob.cookie });
  check('a frozen author\'s post is not found by id', () => assert.equal(hiddenPost.status, 404));

  const hiddenFeed = await api('/api/posts?limit=50', { cookie: bob.cookie });
  check('a frozen author\'s post leaves the feed', () => {
    assert.equal(hiddenFeed.data.some((entry) => String(entry._id) === String(postId)), false);
  });

  const hiddenSearch = await api('/api/users/search?q=alice_prime', { cookie: bob.cookie });
  check('a frozen account is absent from search', () => {
    assert.equal(hiddenSearch.status, 200);
    assert.equal(hiddenSearch.data.users.length, 0);
    assert.equal(hiddenSearch.data.posts.length, 0);
  });

  const ownProfile = await api('/api/users/alice_prime', { cookie: alice.cookie });
  check('the owner still sees their own profile, offline', () => {
    assert.equal(ownProfile.status, 200);
    assert.equal(ownProfile.data.status, 'frozen');
    assert.equal(ownProfile.data.presence.status, 'offline');
  });

  const ownFeed = await api('/api/posts?limit=50', { cookie: alice.cookie });
  check('the owner still sees their own post', () => {
    assert.ok(ownFeed.data.some((entry) => String(entry._id) === String(postId)));
  });

  const frozenPost = await api('/api/posts', {
    method: 'POST',
    cookie: alice.cookie,
    body: { title: 'Should not exist', content: 'frozen writes are blocked' }
  });
  check('a frozen account cannot create content', () => {
    assert.equal(frozenPost.status, 403);
    assert.equal(frozenPost.data.code, 'ACCOUNT_FROZEN');
  });

  const unfreezeWrong = await api('/api/account/freeze', {
    method: 'POST',
    cookie: alice.cookie,
    body: { frozen: false, password: 'wrong-password' }
  });
  check('unfreezing with the wrong password is refused', () => assert.equal(unfreezeWrong.status, 403));

  const unfrozen = await api('/api/account/freeze', {
    method: 'POST',
    cookie: alice.cookie,
    body: { frozen: false, password: 'password123' }
  });
  check('unfreezing restores the account', () => assert.equal(unfrozen.data.status, 'active'));

  const visibleAgain = await api(`/api/posts/${postId}`, { cookie: bob.cookie });
  check('the post is readable again after unfreezing', () => assert.equal(visibleAgain.status, 200));

  // ── Freeze: live socket guard ─────────────────────────────────────────────
  console.log('\n[freeze sockets]');
  const bobFrozen = await api('/api/account/freeze', {
    method: 'POST',
    cookie: bob.cookie,
    body: { frozen: true, password: 'password123' }
  });
  check('a connected member can freeze their account', () => assert.equal(bobFrozen.status, 200));

  const refused = waitFor(sockets.bob, 'error_msg', (payload) => payload?.code === 'ACCOUNT_FROZEN');
  sockets.bob.emit('send_message', { channelId, text: 'must not arrive' });
  const refusedPayload = await refused;
  check('an open socket is refused immediately after freezing', () => assert.ok(refusedPayload));

  const bobUnfrozen = await api('/api/account/freeze', {
    method: 'POST',
    cookie: bob.cookie,
    body: { frozen: false, password: 'password123' }
  });
  check('the member can unfreeze', () => assert.equal(bobUnfrozen.status, 200));

  await sendMessage(sockets.bob, channelId, 'post-unfreeze message');
  check('the same socket can send again after unfreezing', () => assert.equal(true, true));

  // ── Second server with no successor -> dissolve on deletion ──────────────
  console.log('\n[solo server]');
  const solo = await api('/api/communities', {
    method: 'POST',
    cookie: alice.cookie,
    body: { name: 'Solo Vault', description: 'nobody else is here' }
  });
  check('a second, memberless server is created', () => assert.equal(solo.status, 201));
  const soloSlug = solo.data.slug;

  // ── Squad chat ownership ──────────────────────────────────────────────────
  console.log('\n[squad succession]');
  const party = await api('/api/lfg', {
    method: 'POST',
    cookie: alice.cookie,
    body: { gameTitle: 'Settings Arena', activity: 'Ranked', maxSlots: 2 }
  });
  check('a squad is created', () => assert.equal(party.status, 201, JSON.stringify(party.data)));
  const partyId = party.data._id;

  const requested = await api(`/api/lfg/${partyId}/request`, {
    method: 'POST',
    cookie: bob.cookie,
    body: { message: 'invite me' }
  });
  check('a player requests a slot', () => assert.equal(requested.status, 200));

  const accepted = await api(`/api/lfg/${partyId}/respond`, {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { userId: bob.id, action: 'accept' }
  });
  check('accepting the last slot locks the squad and opens the chat', () => {
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
    assert.ok(accepted.data.party?.chatId, 'chatId must be present');
    assert.equal(accepted.data.party.state, 'locked');
  });
  const chatId = accepted.data.party.chatId;

  const chatBefore = await api(`/api/squad-chats/${chatId}`, { cookie: alice.cookie });
  check('the departing owner owns the chat before deletion', () => {
    assert.equal(chatBefore.status, 200);
    assert.equal(chatBefore.data.chat.isOwner, true);
  });

  // ── Succession preview ────────────────────────────────────────────────────
  console.log('\n[succession preview]');
  const preview = await api('/api/account/succession-preview', { cookie: alice.cookie });
  check('the preview names the server successor', () => {
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    const hq = preview.data.communities.find((entry) => entry.name === 'Settings HQ');
    assert.ok(hq);
    assert.equal(hq.action, 'transfer');
    assert.equal(hq.successor.username, 'bob');
  });

  check('the preview marks a memberless server for dissolution', () => {
    const empty = preview.data.communities.find((entry) => entry.name === 'Solo Vault');
    assert.ok(empty);
    assert.equal(empty.action, 'dissolve');
    assert.equal(empty.successor, null);
  });

  check('the preview names the squad successor', () => {
    const squad = preview.data.squads.find((entry) => String(entry.id) === String(partyId));
    assert.ok(squad);
    assert.equal(squad.action, 'transfer');
    assert.equal(squad.successor.username, 'bob');
  });

  // ── Google link fail-closed ───────────────────────────────────────────────
  console.log('\n[google link]');
  const providerConfig = await api('/api/auth/providers');

  if (providerConfig.data.google.enabled) {
    const missingCredential = await api('/api/auth/link-google', {
      method: 'POST',
      cookie: carol.cookie,
      body: {}
    });
    check('linking without a credential is refused', () => assert.equal(missingCredential.status, 400));

    const fakeCredential = await api('/api/auth/link-google', {
      method: 'POST',
      cookie: carol.cookie,
      body: { credential: 'not-a-google-id-token' }
    });
    check('an unverifiable Google credential is refused', () => assert.equal(fakeCredential.status, 401));
  } else {
    const unavailable = await api('/api/auth/link-google', {
      method: 'POST',
      cookie: carol.cookie,
      body: { credential: 'anything' }
    });
    check('Google linking is explicitly unavailable when unconfigured', () => {
      assert.equal(unavailable.status, 503);
    });
  }

  const unlinkUnlinked = await api('/api/auth/link-google', {
    method: 'DELETE',
    cookie: carol.cookie
  });
  check('unlinking an unlinked account is a safe no-op', () => {
    assert.equal(unlinkUnlinked.status, 200);
    assert.deepEqual(unlinkUnlinked.data.providers, []);
  });

  // ── Session revocation ────────────────────────────────────────────────────
  console.log('\n[sessions]');
  const signedOut = await api('/api/auth/logout-all', { method: 'POST', cookie: carol.cookie });
  check('sign out everywhere succeeds', () => assert.equal(signedOut.status, 200));

  const staleCookie = await api('/api/auth/me', { cookie: carol.cookie });
  check('the old cookie is revoked immediately', () => assert.equal(staleCookie.status, 401));

  // ── Immediate deletion + succession ───────────────────────────────────────
  console.log('\n[deletion]');
  const badName = await api('/api/account/delete-now', {
    method: 'POST',
    cookie: alice.cookie,
    body: { confirmUsername: 'someone-else', password: 'password123' }
  });
  check('deletion requires the exact handle', () => assert.equal(badName.status, 400));

  const badPassword = await api('/api/account/delete-now', {
    method: 'POST',
    cookie: alice.cookie,
    body: { confirmUsername: 'alice_prime', password: 'wrong-password' }
  });
  check('deletion requires the password', () => assert.equal(badPassword.status, 403));

  const deleted = await api('/api/account/delete-now', {
    method: 'POST',
    cookie: alice.cookie,
    body: { confirmUsername: 'alice_prime', password: 'password123' }
  });
  check('the owner can delete immediately', () => {
    assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
    assert.equal(deleted.data.deleted, true);
    assert.equal(deleted.data.succession.communities.length, 2);
    assert.equal(deleted.data.succession.squads.length, 1);
  });

  const deadCookie = await api('/api/auth/me', { cookie: alice.cookie });
  check('the deleted session is revoked', () => assert.equal(deadCookie.status, 401));

  const tombstone = await User.findById(alice.id).lean();
  check('the account is anonymised in place', () => {
    assert.equal(tombstone.status, 'deleted');
    assert.match(tombstone.username, /^deleted_/);
    assert.match(tombstone.email, /@deleted\.invalid$/);
    assert.equal(tombstone.authIdentities.length, 0);
  });

  const transferred = await api(`/api/communities/${communitySlug}`, { cookie: bob.cookie });
  const transferredCommunity = transferred.data?.community;
  check('the admin inherits the server', () => {
    assert.equal(transferred.status, 200, JSON.stringify(transferred.data));
    assert.equal(String(transferredCommunity.ownerId?._id || transferredCommunity.ownerId), String(bob.id));
    assert.equal(transferred.data.callerRole, 'owner');
    const bobMember = transferredCommunity.members.find(
      (m) => String(m.userId?._id || m.userId) === String(bob.id)
    );
    assert.equal(bobMember.role, 'owner');
    assert.equal(
      transferredCommunity.members.some(
        (m) => String(m.userId?._id || m.userId) === String(alice.id)
      ),
      false,
      'the deleted account is no longer a member'
    );
  });

  const dissolved = await api(`/api/communities/${soloSlug}`, { cookie: bob.cookie });
  check('a memberless server is dissolved', () => assert.equal(dissolved.status, 404));

  const postGone = await api(`/api/posts/${postId}`, { cookie: bob.cookie });
  check('the deleted account\'s posts are removed', () => assert.equal(postGone.status, 404));

  const squadTransferred = await api(`/api/lfg/${partyId}`, { cookie: bob.cookie });
  check('the veteran member becomes squad leader', () => {
    assert.equal(squadTransferred.status, 200, JSON.stringify(squadTransferred.data));
    assert.equal(String(squadTransferred.data.leader._id), String(bob.id));
    assert.equal(squadTransferred.data.viewerMembership, 'leader');
  });

  const chatTransferred = await api(`/api/squad-chats/${chatId}`, { cookie: bob.cookie });
  check('the temporary chat refresh right moves with leadership', () => {
    assert.equal(chatTransferred.status, 200, JSON.stringify(chatTransferred.data));
    assert.equal(chatTransferred.data.chat.isOwner, true);
    assert.equal(chatTransferred.data.chat.canRefresh, true);
  });

  const chatRecord = await SquadChat.findById(chatId).lean();
  check('the chat owner is updated in the database', () => {
    assert.equal(String(chatRecord.ownerUserId), String(bob.id));
    assert.equal(chatRecord.ownerUsername, 'bob');
  });

  const fresh = await api('/api/auth/register', {
    method: 'POST',
    body: { username: 'alice_fresh', email: 'alice@example.com', password: 'password123' }
  });
  check('the released email can register a genuinely fresh account', () => {
    assert.equal(fresh.status, 201, JSON.stringify(fresh.data));
    assert.notEqual(String(fresh.data.user.id), String(alice.id));
  });

  const remainingPosts = await Post.countDocuments({ userId: alice.id });
  check('no posts remain attached to the tombstone', () => assert.equal(remainingPosts, 0));

  const remainingOwnedCommunities = await Community.countDocuments({ ownerId: alice.id });
  check('no server points at the deleted owner', () => assert.equal(remainingOwnedCommunities, 0));

  const remainingLedSquads = await Party.countDocuments({ leaderId: alice.id, status: { $ne: 'closed' } });
  check('no open squad points at the deleted leader', () => assert.equal(remainingLedSquads, 0));
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
