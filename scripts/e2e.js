/**
 * End-to-end verification for the permission/chat rework.
 *
 * Runs entirely against a THROWAWAY database on the same cluster:
 *   E2E=1 node scripts/e2e.js
 *
 * It creates a database named `gamerhub_e2e` (derived from MONGO_URI), seeds
 * users, exercises REST + Socket.io, then drops it. Never point this at
 * production data.
 */
require('dotenv').config();
const http = require('http');
const assert = require('assert/strict');
const mongoose = require('mongoose');

// Unique per run so a previous run's cleanup can never race this one.
const E2E_DB = `gamerhub_e2e_${Date.now().toString(36)}`;

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

const {
  api, check, connectSocket, registerUser, report, setBase, waitFor
} = require('./lib/e2e-harness');

const register = registerUser;

async function run() {
  await connectDB();
  console.log(`Using throwaway database: ${E2E_DB}`);

  const server = http.createServer(app);
  initSocket(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  setBase(`http://127.0.0.1:${server.address().port}`);

  const alice = await register('alice');
  const bob = await register('bob');
  const carol = await register('carol');
  const dave = await register('dave');

  const ctx = { alice, bob, carol, dave };

  try {
    await scenarios(ctx);
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    server.close();
  }

  const failed = report();
  if (failed.length) process.exit(1);
}

async function scenarios(ctx) {
  const { alice, bob, carol, dave } = ctx;
  console.log('\n[feed projection]');
  const created = await api('/api/posts', {
    method: 'POST',
    cookie: alice.cookie,
    body: { title: 'First post', content: 'hello', tags: ['FPS'], linkPreview: { url: 'javascript:alert(1)' } }
  });
  check('post created', () => assert.equal(created.status, 201));

  const feed = await api('/api/posts?limit=1');
  check('anonymous feed is 200', () => assert.equal(feed.status, 200));
  check('feed author projection is minimal', () =>
    assert.deepEqual(Object.keys(feed.data[0].userId).sort(), ['_id', 'level', 'role', 'username']));
  check('feed never leaks email or passwordHash', () => {
    const blob = JSON.stringify(feed.data);
    assert.equal(blob.includes('passwordHash'), false);
    assert.equal(blob.includes('@example.com'), false);
  });

  const post = await api(`/api/posts/${created.data._id}`);
  check('unsafe link preview was dropped', () =>
    assert.equal(post.data.linkPreview?.url ?? null, null));

  console.log('\n[input guards]');
  const nanPage = await api('/api/posts?page=abc&limit=abc');
  check('NaN pagination does not 500', () => assert.equal(nanPage.status, 200));

  const ssrf = await api('/api/posts/preview?url=http://127.0.0.1:1/', { cookie: alice.cookie });
  // The SSRF guard rejects internally; the scraper reports "no preview" so a
  // caller cannot use the status code as a private-network oracle.
  check('link preview blocks loopback', () => {
    assert.ok([400, 422].includes(ssrf.status), `got ${ssrf.status} ${JSON.stringify(ssrf.data)}`);
    assert.equal(ssrf.data.title, undefined);
  });

  const ssrfNoAuth = await api('/api/posts/preview?url=https://example.com');
  check('link preview requires auth', () => assert.equal(ssrfNoAuth.status, 401));

  console.log('\n[CORS]');
  const evil = await api('/api/posts?limit=1', { origin: 'https://evil.vercel.app' });
  check('wildcard vercel.app origin rejected', () => assert.equal(evil.status, 403));
  const good = await api('/api/posts?limit=1', { origin: 'http://localhost:3000' });
  check('configured origin allowed', () =>
    assert.equal(good.headers.get('access-control-allow-origin'), 'http://localhost:3000'));

  console.log('\n[server creation]');
  const made = await api('/api/communities', {
    method: 'POST',
    cookie: alice.cookie,
    body: { name: 'E2E Servers', description: 'test server', icon: '🎮' }
  });
  check('server created', () => assert.equal(made.status, 201, JSON.stringify(made.data)));
  check('owner gets full permissions', () => {
    assert.ok(made.data.callerPermissions.includes('MANAGE_SERVER'));
    assert.equal(made.data.callerRole, 'owner');
  });

  const serverId = made.data._id;
  const slug = made.data.slug;

  const detail = await api(`/api/communities/${slug}`, { cookie: alice.cookie });
  check('general channel exists', () =>
    assert.ok(detail.data.channels.some((c) => c.name === 'general')));
  const generalId = detail.data.channels.find((c) => c.name === 'general')._id;

  console.log('\n[private servers]');
  const madePrivate = await api(`/api/communities/${serverId}`, {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { isPrivate: true }
  });
  check('owner can make server private', () => assert.equal(madePrivate.status, 200));

  const outsiderView = await api(`/api/communities/${slug}`, { cookie: bob.cookie });
  check('non-member cannot view private server', () => assert.equal(outsiderView.status, 403));

  const ownerView = await api(`/api/communities/${slug}`, { cookie: alice.cookie });
  check('owner can still view private server', () => assert.equal(ownerView.status, 200));

  const selfJoin = await api(`/api/communities/${serverId}/join`, { method: 'POST', cookie: bob.cookie });
  check('private server rejects self-join', () => assert.equal(selfJoin.status, 403));

  const publicProfile = await api('/api/users/alice', { cookie: bob.cookie });
  check('profile never exposes another user\'s saved posts', () =>
    assert.equal(publicProfile.data.savedPosts, undefined));
  check('profile payload carries no credentials', () => {
    const blob = JSON.stringify(publicProfile.data);
    assert.equal(blob.includes('passwordHash'), false);
    assert.equal(blob.includes('@example.com'), false);
  });

  const ownProfile = await api('/api/users/alice', { cookie: alice.cookie });
  check('owner sees their own private server on their profile', () => {
    const names = (ownProfile.data.communities || []).map((c) => c.name);
    assert.ok(names.includes('E2E Servers'), JSON.stringify(names));
  });

  console.log('\n[member management]');
  const addBob = await api(`/api/communities/${serverId}/members`, {
    method: 'POST',
    cookie: alice.cookie,
    body: { username: 'bob', role: 'moderator' }
  });
  check('owner adds bob as moderator', () => assert.equal(addBob.status, 201, JSON.stringify(addBob.data)));

  // Alice now belongs to a private server other people cannot see.
  const outsiderProfile = await api('/api/users/alice', { cookie: dave.cookie });
  check('outsider cannot see a private server on someone\'s profile', () => {
    const names = (outsiderProfile.data.communities || []).map((c) => c.name);
    assert.equal(names.includes('E2E Servers'), false, JSON.stringify(names));
  });

  const fellowMemberProfile = await api('/api/users/alice', { cookie: bob.cookie });
  check('fellow member can see the shared private server', () => {
    const names = (fellowMemberProfile.data.communities || []).map((c) => c.name);
    assert.ok(names.includes('E2E Servers'), JSON.stringify(names));
  });

  const bobView = await api(`/api/communities/${slug}`, { cookie: bob.cookie });
  check('moderator permissions are moderation-only', () => {
    const perms = bobView.data.callerPermissions;
    assert.ok(perms.includes('MANAGE_MESSAGES'));
    assert.ok(perms.includes('BYPASS_SLOWMODE'));
    assert.equal(perms.includes('MANAGE_ROLES'), false);
    assert.equal(perms.includes('MANAGE_SERVER'), false);
  });

  const bobId = bobView.data.community.members.find((m) => m.userId.username === 'bob').userId._id;
  const carolAdd = await api(`/api/communities/${serverId}/members`, {
    method: 'POST',
    cookie: alice.cookie,
    body: { username: 'carol', role: 'member' }
  });
  check('owner adds carol as member', () => assert.equal(carolAdd.status, 201));

  const modEscalation = await api(`/api/communities/${serverId}/members/${bobId}/role`, {
    method: 'PATCH',
    cookie: bob.cookie,
    body: { newRole: 'admin' }
  });
  check('moderator cannot grant roles', () => assert.equal(modEscalation.status, 403));

  const promote = await api(`/api/communities/${serverId}/members/${bobId}/role`, {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { newRole: 'admin' }
  });
  check('owner promotes bob to admin', () => assert.equal(promote.status, 200));

  const carolView = await api(`/api/communities/${slug}`, { cookie: carol.cookie });
  const carolId = carolView.data.community.members.find((m) => m.userId.username === 'carol').userId._id;

  const adminEscalation = await api(`/api/communities/${serverId}/members/${carolId}/role`, {
    method: 'PATCH',
    cookie: bob.cookie,
    body: { newRole: 'admin' }
  });
  check('admin cannot grant admin', () => assert.equal(adminEscalation.status, 403));

  const adminPromote = await api(`/api/communities/${serverId}/members/${carolId}/role`, {
    method: 'PATCH',
    cookie: bob.cookie,
    body: { newRole: 'moderator' }
  });
  check('admin can promote to moderator', () => assert.equal(adminPromote.status, 200));

  const kickOwner = await api(`/api/communities/${serverId}/members/${made.data.ownerId}`, {
    method: 'DELETE',
    cookie: bob.cookie
  });
  check('admin cannot kick the owner', () => assert.equal(kickOwner.status, 403));

  const kickCarol = await api(`/api/communities/${serverId}/members/${carolId}`, {
    method: 'DELETE',
    cookie: bob.cookie
  });
  check('admin kicks a member', () => assert.equal(kickCarol.status, 200));

  const carolAfterKick = await api(`/api/communities/${slug}`, { cookie: carol.cookie });
  check('kicked member loses access', () => assert.equal(carolAfterKick.status, 403));

  console.log('\n[channels]');
  const channel = await api(`/api/communities/${serverId}/channels`, {
    method: 'POST',
    cookie: bob.cookie,
    body: { name: 'Staff Only', topic: 'admin', minRoleToRead: 'admin', minRoleToWrite: 'member' }
  });
  check('admin creates a channel', () => assert.equal(channel.status, 201, JSON.stringify(channel.data)));
  check('write gate is raised to the read gate', () => {
    assert.equal(channel.data.minRoleToRead, 'admin');
    assert.equal(channel.data.minRoleToWrite, 'admin');
  });

  const memberChannel = await api(`/api/communities/${serverId}/channels`, {
    method: 'POST',
    cookie: dave.cookie,
    body: { name: 'nope' }
  });
  check('non-member cannot create channels', () => assert.equal(memberChannel.status, 403));

  const delChannel = await api(`/api/communities/${serverId}/channels/${channel.data._id}`, {
    method: 'DELETE',
    cookie: alice.cookie
  });
  check('owner deletes a channel', () => assert.equal(delChannel.status, 200));

  const delLastAttempt = await api(`/api/communities/${serverId}/channels/${generalId}`, {
    method: 'DELETE',
    cookie: alice.cookie
  });
  check('cannot delete the last channel', () => assert.equal(delLastAttempt.status, 400));

  console.log('\n[audit log]');
  const audit = await api(`/api/communities/${serverId}/audit`, { cookie: alice.cookie });
  check('owner reads the audit log', () => assert.equal(audit.status, 200));
  check('audit contains the admin actions', () => {
    const types = new Set(audit.data.entries.map((e) => e.actionType));
    for (const type of ['MEMBER_ADD', 'ROLE_UPDATE', 'MEMBER_KICK', 'CHANNEL_CREATE', 'CHANNEL_DELETE', 'SETTINGS_UPDATE']) {
      assert.ok(types.has(type), `missing ${type}`);
    }
  });

  const auditAsMember = await api(`/api/communities/${serverId}/audit`, { cookie: dave.cookie });
  check('non-member cannot read the audit log', () => assert.equal(auditAsMember.status, 403));

  await socketScenarios(ctx, { serverId, slug, generalId });
}

async function socketScenarios(ctx, { serverId, generalId }) {
  const { alice, bob } = ctx;
  console.log('\n[socket chat]');

  const aliceSocket = await connectSocket(alice.token);
  const bobSocket = await connectSocket(bob.token);

  const aliceJoined = waitFor(aliceSocket, 'joined_channel');
  aliceSocket.emit('join_channel', { channelId: generalId });
  const joined = await aliceJoined;
  check('server returns permissions on join', () => {
    assert.ok(joined, 'no joined_channel event');
    assert.ok(joined.permissions.includes('MANAGE_MESSAGES'));
  });

  const bobJoined = waitFor(bobSocket, 'joined_channel');
  bobSocket.emit('join_channel', { channelId: generalId });
  await bobJoined;

  const incoming = waitFor(aliceSocket, 'new_message', (m) => m.text === 'hello from bob');
  bobSocket.emit('send_message', { channelId: generalId, text: 'hello from bob' });
  const message = await incoming;
  check('message is delivered to the room', () => {
    assert.ok(message, 'no new_message event');
    assert.equal(message.communityRole, 'admin');
  });

  // Cross-server injection: dave owns another server; alice is not a member.
  const daveServer = await api('/api/communities', {
    method: 'POST',
    cookie: ctx.dave.cookie,
    body: { name: 'Dave Server', description: 'other server' }
  });
  const daveDetail = await api(`/api/communities/${daveServer.data.slug}`, { cookie: ctx.dave.cookie });
  const daveChannelId = daveDetail.data.channels[0]._id;

  const crossError = waitFor(aliceSocket, 'error_msg');
  aliceSocket.emit('send_message', {
    channelId: daveChannelId,
    communityId: serverId, // spoofed: claims her own server
    text: 'cross-server injection'
  });
  const crossErr = await crossError;
  check('cannot post into another server channel', () => {
    assert.ok(crossErr, 'expected a FORBIDDEN error');
    assert.equal(crossErr.code, 'FORBIDDEN');
  });

  const floodErrors = [];
  bobSocket.on('error_msg', (payload) => floodErrors.push(payload));
  for (let i = 0; i < 7; i += 1) {
    bobSocket.emit('send_message', { channelId: generalId, text: `flood ${i}` });
  }
  await new Promise((r) => setTimeout(r, 400));
  check('flood control kicks in after 5 messages', () =>
    assert.ok(floodErrors.some((e) => e.code === 'FLOOD')));

  const outsiderSocket = await connectSocket(ctx.dave.token);
  const outsiderError = waitFor(outsiderSocket, 'error_msg');
  outsiderSocket.emit('join_channel', { channelId: generalId });
  const outsiderErr = await outsiderError;
  check('non-member cannot join a channel', () => {
    assert.ok(outsiderErr, 'expected an error');
    assert.equal(outsiderErr.code, 'FORBIDDEN');
  });

  // Alice (owner) posts, bob (admin) moderates it.
  const modTarget = waitFor(bobSocket, 'new_message', (m) => m.text === 'please moderate me');
  aliceSocket.emit('send_message', { channelId: generalId, text: 'please moderate me' });
  const targetMessage = await modTarget;
  check('owner message reaches the room', () => assert.ok(targetMessage));

  const deleted = waitFor(aliceSocket, 'message_deleted');
  const delErr = waitFor(bobSocket, 'error_msg');
  bobSocket.emit('delete_message', { messageId: targetMessage._id });
  const deletedEvent = await deleted;
  check('moderator deletes another member\'s message', () =>
    assert.ok(deletedEvent && deletedEvent.messageId === targetMessage._id));
  const delErrPayload = await delErr;
  check('delete succeeds without an error', () => assert.equal(delErrPayload, null));

  const daveErr = waitFor(outsiderSocket, 'error_msg');
  outsiderSocket.emit('send_message', { channelId: generalId, text: 'intruder' });
  const davePayload = await daveErr;
  check('non-member cannot send messages', () => assert.equal(davePayload?.code, 'FORBIDDEN'));

  console.log('\n[slowmode & live membership]');
  const addDave = await api(`/api/communities/${serverId}/members`, {
    method: 'POST',
    cookie: alice.cookie,
    body: { username: 'dave', role: 'member' }
  });
  check('owner adds a member for the slowmode test', () => assert.equal(addDave.status, 201));

  const slowPatch = await api(`/api/communities/${serverId}/channels/${generalId}`, {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { slowModeSeconds: 5 }
  });
  check('slowmode is enabled on the channel', () => assert.equal(slowPatch.status, 200));

  const daveSocket = await connectSocket(ctx.dave.token);
  const daveJoinEvent = waitFor(daveSocket, 'joined_channel');
  daveSocket.emit('join_channel', { channelId: generalId });
  const daveJoined = await daveJoinEvent;
  check('newly added member can join the channel', () => assert.ok(daveJoined));

  const slowError = waitFor(daveSocket, 'error_msg', () => true, 3000);
  daveSocket.emit('send_message', { channelId: generalId, text: 'slow 1' });
  await new Promise((resolve) => setTimeout(resolve, 200));
  daveSocket.emit('send_message', { channelId: generalId, text: 'slow 2' });
  const slowPayload = await slowError;
  check('slowmode blocks a second rapid message', () => assert.equal(slowPayload?.code, 'SLOWMODE'));

  const ownerSlowError = waitFor(aliceSocket, 'error_msg', () => true, 1200);
  aliceSocket.emit('send_message', { channelId: generalId, text: 'owner bypass 1' });
  await new Promise((resolve) => setTimeout(resolve, 200));
  aliceSocket.emit('send_message', { channelId: generalId, text: 'owner bypass 2' });
  const ownerSlowPayload = await ownerSlowError;
  check('owner bypasses slowmode', () => assert.equal(ownerSlowPayload, null));

  // Dave is also the owner of his own server. A second socket, parked in one of
  // HIS channels, must survive the eviction from Alice's server.
  const daveOwnChannelId = (await api(`/api/communities/${daveServer.data.slug}`, { cookie: ctx.dave.cookie }))
    .data.channels[0]._id;
  const daveOtherSocket = await connectSocket(ctx.dave.token);
  const daveOwnJoin = waitFor(daveOtherSocket, 'joined_channel');
  daveOtherSocket.emit('join_channel', { channelId: daveOwnChannelId });
  const ownJoined = await daveOwnJoin;
  check('second socket joins its own server channel', () => assert.ok(ownJoined));

  const revokedEvent = waitFor(daveSocket, 'membership_revoked', () => true, 4000);
  const leaveRes = await api(`/api/communities/${serverId}/leave`, { method: 'POST', cookie: ctx.dave.cookie });
  check('member leaves the server', () => assert.equal(leaveRes.status, 200));
  const revoked = await revokedEvent;
  check('live socket is evicted on leave', () => assert.ok(revoked));

  const afterLeaveMessage = waitFor(daveSocket, 'new_message', () => true, 900);
  bobSocket.emit('send_message', { channelId: generalId, text: 'after you left' });
  const leaked = await afterLeaveMessage;
  check('evicted socket stops receiving that server\'s messages', () => assert.equal(leaked, null));

  const ownRoomEcho = waitFor(daveOtherSocket, 'new_message', (m) => m.text === 'still my room');
  daveOtherSocket.emit('send_message', { channelId: daveOwnChannelId, text: 'still my room' });
  const ownEcho = await ownRoomEcho;
  check('eviction from one server keeps another server\'s live chat', () => assert.ok(ownEcho));

  for (const socket of [aliceSocket, bobSocket, outsiderSocket, daveSocket, daveOtherSocket]) socket.disconnect();
}

run().catch((err) => {
  console.error('\nE2E failed:', err);
  process.exit(1);
});
