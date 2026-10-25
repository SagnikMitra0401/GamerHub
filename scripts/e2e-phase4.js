/**
 * End-to-end verification for the Phase 4 feature set (LFG, notifications,
 * presence, personalized feed, game catalog, gaming bot, admin monitor).
 *
 * Runs against a THROWAWAY database on the same cluster:
 *   node scripts/e2e-phase4.js
 *
 * It creates `gamerhub_p4_<timestamp>`, seeds users, exercises REST + Socket.io,
 * then drops the database. Never point this at production data.
 */
require('dotenv').config();
const http = require('http');
const assert = require('assert/strict');
const mongoose = require('mongoose');

const E2E_DB = `gamerhub_p4_${Date.now().toString(36)}`;

function tempMongoUri() {
  const url = new URL(process.env.MONGO_URI);
  url.pathname = `/${E2E_DB}`;
  return url.toString();
}

process.env.MONGO_URI = tempMongoUri();
process.env.NODE_ENV = 'test';
process.env.CLIENT_URL = 'http://localhost:3000';
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '10000';
process.env.PREVIEW_RATE_LIMIT_MAX = '10000';
process.env.DISABLE_RETENTION_WORKER = '1';

const connectDB = require('../server/config/db');
const app = require('../server/app');
const { initSocket } = require('../server/config/socket');
const Post = require('../server/models/Post');
const User = require('../server/models/User');

const {
  api, check, connectSocket, registerUser, report, setBase, waitFor
} = require('./lib/e2e-harness');

// This suite also confirms that the cookie alone resolves the session.
const register = (username) => registerUser(username, { probeId: true });

async function run() {
  await connectDB();
  console.log(`Using throwaway database: ${E2E_DB}`);

  const server = http.createServer(app);
  initSocket(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  setBase(`http://127.0.0.1:${server.address().port}`);

  try {
    await scenarios();
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    server.close();
  }

  const failed = report();
  if (failed.length) process.exit(1);
}

async function scenarios() {
  const alice = await register('alice');
  const bob = await register('bob');
  const carol = await register('carol');

  console.log('\n[preferences]');
  const prefs = await api('/api/users/me/preferences', {
    method: 'PATCH',
    cookie: alice.cookie,
    body: {
      favoriteGames: ['Valorant', 'valorant', '  Apex Legends  '],
      favoriteGenres: ['Shooter'],
      platforms: ['PC', 'Xbox']
    }
  });
  check('preferences saved and de-duplicated', () => {
    assert.equal(prefs.status, 200);
    assert.deepEqual(prefs.data.preferences.favoriteGames, ['Valorant', 'Apex Legends']);
    assert.deepEqual(prefs.data.preferences.platforms, ['PC', 'Xbox']);
  });

  const prefsAnon = await api('/api/users/me/preferences', {
    method: 'PATCH',
    body: { favoriteGames: ['x'] }
  });
  check('anonymous preference write is rejected', () => assert.equal(prefsAnon.status, 401));

  const badPlatform = await api('/api/users/me/preferences', {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { platforms: ['Steam'] }
  });
  check('unknown platform is rejected', () => assert.equal(badPlatform.status, 400));

  console.log('\n[personalized feed]');
  const older = await Post.create({
    userId: alice.id,
    title: 'Valorant patch notes',
    content: 'buff',
    tags: ['valorant', 'patch']
  });
  await new Promise((r) => setTimeout(r, 20));
  const newer = await Post.create({
    userId: bob.id,
    title: 'Unrelated news',
    content: 'hello',
    tags: ['news']
  });

  const forYou = await api('/api/posts?sort=foryou&limit=10', { cookie: alice.cookie });
  check('for-you feed returns 200', () => assert.equal(forYou.status, 200));
  check('favourite-game post is ranked first', () =>
    assert.equal(String(forYou.data[0]._id), String(older._id)));
  check('ranking explains the match', () =>
    assert.deepEqual(forYou.data[0].matchedTags, ['valorant']));

  const forYouBob = await api('/api/posts?sort=foryou&limit=10', { cookie: bob.cookie });
  check('a user with no preferences still gets a feed', () => assert.equal(forYouBob.status, 200));

  const forYouAnon = await api('/api/posts?sort=foryou&limit=10');
  check('anonymous for-you falls back to latest', () => {
    assert.equal(forYouAnon.status, 200);
    assert.equal(String(forYouAnon.data[0]._id), String(newer._id));
  });

  console.log('\n[presence]');
  const bobSocket = await connectSocket(bob.token);
  const playingBroadcast = waitFor(bobSocket, 'presence_change', (p) => p.status === 'in_game');

  const playing = await api('/api/users/presence', {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { status: 'in_game', activeGame: 'Valorant' }
  });
  check('presence set to in_game', () => {
    assert.equal(playing.status, 200);
    assert.equal(playing.data.presence.status, 'in_game');
    assert.equal(playing.data.presence.activeGame, 'Valorant');
  });

  const presenceEvent = await playingBroadcast;
  check('presence change is broadcast in real time', () => {
    assert.equal(presenceEvent?.status, 'in_game');
    assert.equal(presenceEvent?.activeGame, 'Valorant');
  });

  const publicProfile = await api('/api/users/alice');
  check('public profile shows the active game', () =>
    assert.deepEqual(publicProfile.data.presence, { status: 'in_game', activeGame: 'Valorant' }));
  check('public profile hides discovery preferences', () =>
    assert.equal(publicProfile.data.preferences, undefined));

  const offlineBroadcast = waitFor(bobSocket, 'presence_change', (p) => p.status === 'offline');
  const invisible = await api('/api/users/presence', {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { status: 'invisible' }
  });
  check('presence set to invisible', () => assert.equal(invisible.status, 200));
  const hiddenEvent = await offlineBroadcast;
  check('invisible is broadcast as offline', () => {
    assert.equal(hiddenEvent?.status, 'offline');
    assert.equal(hiddenEvent?.activeGame, '');
  });

  const hidden = await api('/api/users/alice');
  check('invisible users appear offline to others', () =>
    assert.deepEqual(hidden.data.presence, { status: 'offline', activeGame: '' }));

  const selfView = await api('/api/auth/me', { cookie: alice.cookie });
  check('the user still sees their own invisible status', () =>
    assert.equal(selfView.data.user.presence.status, 'invisible'));

  const badPresence = await api('/api/users/presence', {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { status: 'in_game' }
  });
  check('in_game requires a game name', () => assert.equal(badPresence.status, 400));

  // The community member sidebar must use the same public projection.
  const madeServer = await api('/api/communities', {
    method: 'POST',
    cookie: alice.cookie,
    body: { name: 'Presence Test', description: 'presence check', icon: '🎮' }
  });
  check('server created for the presence check', () => assert.equal(madeServer.status, 201));

  const joinedServer = await api(`/api/communities/${madeServer.data._id}/join`, {
    method: 'POST',
    cookie: bob.cookie
  });
  check('bob joins the presence check server', () => assert.equal(joinedServer.status, 200));

  const memberView = await api(`/api/communities/${madeServer.data.slug}`, { cookie: bob.cookie });
  check('member list hides the invisible state', () => {
    const entry = (memberView.data.community.members || [])
      .find((m) => String(m.userId?._id) === String(alice.id));
    assert.ok(entry, 'alice is missing from the member list');
    assert.deepEqual(entry.userId.presence, { status: 'offline', activeGame: '' });
  });

  console.log('\n[lfg board]');
  const anonBoard = await api('/api/lfg');
  check('board is public', () => assert.equal(anonBoard.status, 200));

  const anonMine = await api('/api/lfg/mine');
  check('my squads requires auth', () => assert.equal(anonMine.status, 401));

  const aliceSocket = await connectSocket(alice.token);
  await new Promise((r) => setTimeout(r, 150));

  const createdEvent = waitFor(aliceSocket, 'lfg_slot_updated', (p) => p.status === 'open');
  const created = await api('/api/lfg', {
    method: 'POST',
    cookie: alice.cookie,
    body: {
      gameTitle: 'Valorant',
      activity: 'Ranked Competitive',
      maxSlots: 3,
      requirements: { minRank: 'Diamond+', micRequired: true }
    }
  });
  check('squad created', () => assert.equal(created.status, 201, JSON.stringify(created.data)));
  check('leader is the only member', () => {
    assert.equal(created.data.members.length, 1);
    assert.equal(created.data.members[0].role, 'leader');
    assert.equal(created.data.openSlots, 2);
  });

  const broadcast = await createdEvent;
  check('creation broadcasts lfg_slot_updated', () => assert.equal(broadcast?.status, 'open'));

  const badSquad = await api('/api/lfg', {
    method: 'POST',
    cookie: alice.cookie,
    body: { gameTitle: '', maxSlots: 99 }
  });
  check('invalid squad is rejected', () => assert.equal(badSquad.status, 400));

  const outsiderRequest = await api(`/api/lfg/${created.data._id}/request`, {
    method: 'POST',
    cookie: alice.cookie,
    body: {}
  });
  check('leader cannot request their own squad', () => assert.equal(outsiderRequest.status, 409));

  console.log('\n[join request + notification]');
  const requestNotification = waitFor(aliceSocket, 'notification', (n) => n.type === 'lfg_request');
  const requestEvent = waitFor(aliceSocket, 'lfg_join_request');

  const joinRequest = await api(`/api/lfg/${created.data._id}/request`, {
    method: 'POST',
    cookie: bob.cookie,
    body: { message: 'I main Jett' }
  });
  check('join request accepted by the API', () => assert.equal(joinRequest.status, 200));

  const notification = await requestNotification;
  check('leader receives a live lfg_request notification', () => {
    assert.ok(notification, 'no notification received');
    assert.match(notification.title, /bob/);
    assert.equal(notification.read, false);
  });

  const live = await requestEvent;
  check('leader receives the lfg_join_request socket event', () =>
    assert.equal(live?.requester?.username, 'bob'));

  const duplicate = await api(`/api/lfg/${created.data._id}/request`, {
    method: 'POST',
    cookie: bob.cookie,
    body: {}
  });
  check('duplicate request is rejected', () => assert.equal(duplicate.status, 409));

  const mine = await api('/api/lfg/mine', { cookie: alice.cookie });
  check('leader sees the pending request', () =>
    assert.equal(mine.data.items[0].requests.length, 1));
  check('request message is stored', () =>
    assert.equal(mine.data.items[0].requests[0].message, 'I main Jett'));

  const bobView = await api(`/api/lfg/${created.data._id}`, { cookie: bob.cookie });
  check('non-leaders cannot see pending requests', () => {
    assert.equal(bobView.data.requests, undefined);
    assert.equal(bobView.data.requestCount, undefined);
  });

  console.log('\n[accepting a request]');
  const acceptedNotification = waitFor(
    bobSocket,
    'notification',
    (n) => n.type === 'lfg_accepted'
  );

  const wrongLeader = await api(`/api/lfg/${created.data._id}/respond`, {
    method: 'PATCH',
    cookie: bob.cookie,
    body: { userId: bob.id, action: 'accept' }
  });
  check('only the leader can accept', () => assert.equal(wrongLeader.status, 403));

  const accepted = await api(`/api/lfg/${created.data._id}/respond`, {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { userId: bob.id, action: 'accept' }
  });
  check('leader accepts the request', () => assert.equal(accepted.status, 200, JSON.stringify(accepted.data)));
  check('applicant is now a member', () => {
    assert.equal(accepted.data.party.members.length, 2);
    assert.equal(accepted.data.party.openSlots, 1);
  });

  const acceptedPing = await acceptedNotification;
  check('applicant is notified of acceptance', () => assert.ok(acceptedPing));

  const staleAccept = await api(`/api/lfg/${created.data._id}/respond`, {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { userId: bob.id, action: 'accept' }
  });
  check('the same request cannot be accepted twice', () => assert.equal(staleAccept.status, 404));

  const bobMine = await api('/api/lfg/mine', { cookie: bob.cookie });
  check('accepted member sees the squad in "mine"', () =>
    assert.equal(bobMine.data.items.length, 1));

  console.log('\n[filling and closing a squad]');
  await api(`/api/lfg/${created.data._id}/request`, {
    method: 'POST',
    cookie: carol.cookie,
    body: {}
  });
  const filled = await api(`/api/lfg/${created.data._id}/respond`, {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { userId: carol.id, action: 'accept' }
  });
  check('a full squad flips to status "full"', () => {
    assert.equal(filled.status, 200);
    assert.equal(filled.data.party.status, 'full');
    assert.equal(filled.data.party.openSlots, 0);
  });

  const boardAfterFill = await api('/api/lfg');
  check('full squads leave the board', () =>
    assert.equal(boardAfterFill.data.items.some((p) => p._id === created.data._id), false));

  const closeByOther = await api(`/api/lfg/${created.data._id}`, {
    method: 'DELETE',
    cookie: bob.cookie
  });
  check('a member cannot close the squad', () => assert.equal(closeByOther.status, 403));

  const closed = await api(`/api/lfg/${created.data._id}`, {
    method: 'DELETE',
    cookie: alice.cookie
  });
  check('leader closes the squad', () => assert.equal(closed.status, 200));

  console.log('\n[notifications API]');
  const inbox = await api('/api/notifications', { cookie: alice.cookie });
  check('inbox lists notifications', () => {
    assert.equal(inbox.status, 200);
    assert.ok(inbox.data.items.length >= 1);
    assert.ok(inbox.data.unreadCount >= 1);
  });
  check('notifications never leak the recipient id of other users', () =>
    assert.equal(inbox.data.items.every((n) => String(n.userId) === String(alice.id)), true));

  const bobInbox = await api('/api/notifications', { cookie: bob.cookie });
  check('notifications are per-user', () =>
    assert.equal(bobInbox.data.items.every((n) => String(n.userId) === String(bob.id)), true));

  const first = inbox.data.items[0];
  const readOne = await api(`/api/notifications/${first._id}/read`, {
    method: 'PATCH',
    cookie: bob.cookie
  });
  check('another user cannot mark my notification read', () => assert.equal(readOne.status, 404));

  const markedRead = await api(`/api/notifications/${first._id}/read`, {
    method: 'PATCH',
    cookie: alice.cookie
  });
  check('owner marks a notification read', () => {
    assert.equal(markedRead.status, 200);
    assert.equal(markedRead.data.notification.read, true);
  });

  const allRead = await api('/api/notifications/read-all', {
    method: 'POST',
    cookie: alice.cookie
  });
  check('mark-all-read clears the badge', () => assert.equal(allRead.data.unreadCount, 0));

  console.log('\n[gaming bot]');
  const savedKey = process.env.YOUTUBE_API_KEY;
  delete process.env.YOUTUBE_API_KEY;

  const botStatus = await api('/api/bot/status', { cookie: alice.cookie });
  check('bot status reports unconfigured', () => {
    assert.equal(botStatus.status, 200);
    assert.equal(botStatus.data.configured, false);
  });
  check('bot status never returns a key', () =>
    assert.equal(/apikey|api_key|youtube_api/i.test(JSON.stringify(botStatus.data)), false));

  const sync = await api('/api/bot/sync-youtube', { method: 'POST', cookie: alice.cookie });
  check('sync without a key is a clean 503', () => {
    assert.equal(sync.status, 503);
    assert.equal(sync.data.code, 'BOT_NOT_CONFIGURED');
  });

  const syncAnon = await api('/api/bot/sync-youtube', { method: 'POST' });
  check('sync requires auth', () => assert.equal(syncAnon.status, 401));

  if (savedKey === undefined) delete process.env.YOUTUBE_API_KEY;
  else process.env.YOUTUBE_API_KEY = savedKey;

  console.log('\n[admin monitor]');
  const denied = await api('/api/admin/system-health', { cookie: alice.cookie });
  check('normal users cannot read system health', () => assert.equal(denied.status, 403));

  const deniedMetrics = await api('/api/admin/metrics', { cookie: alice.cookie });
  check('normal users cannot read metrics', () => assert.equal(deniedMetrics.status, 403));

  await User.updateOne({ _id: alice.id }, { $set: { role: 'admin' } });
  const health = await api('/api/admin/system-health', { cookie: alice.cookie });
  check('admin reads system health', () => assert.equal(health.status, 200, JSON.stringify(health.data)));

  check('health reports required secrets as configured', () => {
    const keys = health.data.security.secretIsolation.keys;
    const jwt = keys.find((k) => k.name === 'JWT_SECRET');
    assert.equal(jwt.configured, true);
    assert.ok(['strong', 'short'].includes(jwt.strength));
    if (jwt.strength === 'short') console.log('    (JWT_SECRET is shorter than 32 chars — reported as weak)');
  });

  check('health never returns secret values', () => {
    const blob = JSON.stringify(health.data);
    assert.equal(blob.includes(process.env.MONGO_URI), false);
    // Only meaningful for a long secret — a short one can appear by accident.
    if ((process.env.JWT_SECRET || '').length >= 16) {
      assert.equal(blob.includes(process.env.JWT_SECRET), false);
    }
    assert.equal(blob.includes('passwordHash'), false);
  });

  check('client bundle is clean when a build exists', () => {
    const bundle = health.data.security.clientBundle;
    if (!bundle.scanned) return; // no dist/ — nothing to scan
    assert.deepEqual(bundle.leakedKeys, []);
  });

  check('database counts are reported', () => {
    assert.equal(health.data.database.counts.users, 3);
    assert.equal(health.data.database.counts.posts, 2);
    assert.ok(health.data.database.counts.activeParties >= 0);
  });

  check('traffic metrics are collected', () => {
    assert.ok(health.data.health.traffic.totalRequests > 10);
    assert.ok(Array.isArray(health.data.health.traffic.topRoutes));
  });

  const metrics = await api('/api/admin/metrics', { cookie: alice.cookie });
  check('metrics endpoint works for admins', () => assert.equal(metrics.status, 200));

  await User.updateOne({ _id: alice.id }, { $set: { role: 'user' } });

  console.log('\n[game catalog]');
  const catalog = await api('/api/games?limit=3');
  check('catalog responds without auth', () =>
    assert.ok([200, 503].includes(catalog.status), `got ${catalog.status}`));
  if (catalog.status === 200) {
    check('catalog returns normalised games', () => {
      assert.ok(Array.isArray(catalog.data.games));
      if (catalog.data.games.length) {
        assert.equal(typeof catalog.data.games[0].title, 'string');
        assert.equal(typeof catalog.data.games[0].genre, 'string');
      }
    });
  } else {
    console.log('    (catalog unavailable upstream — stale/degraded path returned 503)');
  }

  const badGame = await api('/api/games/not-a-number');
  check('invalid game ids are rejected', () => assert.equal(badGame.status, 400));

  aliceSocket.disconnect();
  bobSocket.disconnect();
}

run().catch((err) => {
  console.error('\nE2E (phase 4) failed:', err);
  process.exit(1);
});
