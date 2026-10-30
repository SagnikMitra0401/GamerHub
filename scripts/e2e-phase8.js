/**
 * Phase 8 end-to-end verification.
 *
 * Runs against a THROWAWAY database on the same cluster:
 *   node scripts/e2e-phase8.js
 *
 * Covers the foundation pack: account governance (session revoke, Google
 * provider surface), the consent-driven invitation engine, the 15-day
 * temporary squad chat (including request-time expiry with the sweep stopped),
 * privacy/blocking, data export and account deletion.
 *
 * Every check that can be a cross-user check is one: an outsider must not open
 * a squad chat, must not accept somebody else's invitation, and a recipient
 * whose settings say "nobody" must not receive an invitation at all.
 */
require('dotenv').config();
const http = require('http');
const assert = require('assert/strict');
const mongoose = require('mongoose');

const E2E_DB = `gamerhub_e2e8_${Date.now().toString(36)}`;

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
process.env.PREVIEW_RATE_LIMIT_MAX = '10000';
process.env.INVITE_RATE_LIMIT_MAX = '10000';
process.env.SQUAD_CHAT_RATE_LIMIT_MAX = '10000';
process.env.EXPORT_RATE_LIMIT_MAX = '50';
process.env.DISABLE_RETENTION_WORKER = '1';

const connectDB = require('../server/config/db');
const app = require('../server/app');
const { initSocket, resetChatTrackers } = require('../server/config/socket');
const { closeDomainConnections } = require('../server/config/connections');

const User = require('../server/models/User');
const Party = require('../server/models/Party');
const Community = require('../server/models/Community');
const SquadChat = require('../server/models/SquadChat');
const SquadChatMessage = require('../server/models/SquadChatMessage');
const { purgeExpiredSquadChats, eraseDeletionPendingUsers } = require('../server/jobs/retention');

const {
  api, check, connectSocket, registerUser, report, setBase, waitFor
} = require('./lib/e2e-harness');

const DAY_MS = 24 * 60 * 60 * 1000;

async function joinSquadChat(socket, chatId) {
  const joined = waitFor(socket, 'joined_squad_chat', (payload) => String(payload?.chat?._id) === String(chatId));
  socket.emit('join_squad_chat', { chatId });
  const result = await joined;
  assert.ok(result, `socket did not join squad chat ${chatId}`);
  return result;
}

async function sendViaSocket(socket, chatId, text) {
  resetChatTrackers();
  const arrived = waitFor(socket, 'squad_message', (message) => message.text === text);
  socket.emit('send_squad_message', { chatId, text });
  const message = await arrived;
  assert.ok(message, `squad message did not arrive: ${text}`);
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
  const dave = await registerUser('dave', { probeId: true });

  const sockets = {
    alice: await connectSocket(alice.token),
    bob: await connectSocket(bob.token),
    carol: await connectSocket(carol.token)
  };

  try {
    await scenarios({ alice, bob, carol, dave, sockets });
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

async function scenarios({ alice, bob, carol, dave, sockets }) {
  // ── Squad lifecycle ───────────────────────────────────────────────────────
  console.log('\n[squad lifecycle]');
  const created = await api('/api/lfg', {
    method: 'POST',
    cookie: alice.cookie,
    body: { gameTitle: 'Phase 8 Arena', activity: 'Ranked', maxSlots: 4 }
  });
  check('a squad is created in the recruiting state', () => {
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.state, 'recruiting');
    assert.equal(created.data.chatId, null);
  });

  const squadId = created.data._id;

  const requested = await api(`/api/lfg/${squadId}/request`, {
    method: 'POST',
    cookie: bob.cookie,
    body: { message: 'invite me' }
  });
  check('a player can request a slot', () => assert.equal(requested.status, 200, JSON.stringify(requested.data)));

  const accepted = await api(`/api/lfg/${squadId}/respond`, {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { userId: bob.id, action: 'accept' }
  });
  check('the leader accepts the request', () => {
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
    assert.equal(accepted.data.party.members.length, 2);
    assert.equal(accepted.data.party.chat, null, 'chat waits until the squad locks');
  });

  const outsiderLock = await api(`/api/lfg/${squadId}/lock`, { method: 'POST', cookie: bob.cookie });
  check('only the leader can lock a squad', () => assert.equal(outsiderLock.status, 403));

  const locked = await api(`/api/lfg/${squadId}/lock`, { method: 'POST', cookie: alice.cookie });
  check('locking opens a chat that expires in 15 days', () => {
    assert.equal(locked.status, 200, JSON.stringify(locked.data));
    assert.equal(locked.data.party.state, 'locked');
    assert.equal(locked.data.chat.state, 'active');
    const days = (new Date(locked.data.chat.expiresAt).getTime() - Date.now()) / DAY_MS;
    assert.ok(days > 14.9 && days <= 15.01, `expected ~15 days, got ${days}`);
    assert.equal(locked.data.chat.isOwner, true);
    assert.equal(locked.data.chat.canRefresh, true);
  });

  const chatId = locked.data.chat._id;

  const reloaded = await api(`/api/lfg/${squadId}`, { cookie: bob.cookie });
  check('the chat summary is attached for a member', () => {
    assert.equal(reloaded.status, 200);
    assert.equal(reloaded.data.chatId, chatId);
    assert.ok(reloaded.data.chat, 'member view includes chat meta');
    assert.equal(reloaded.data.chat.canRefresh, false, 'only the leader may extend');
  });

  const outsiderView = await api(`/api/lfg/${squadId}`, { cookie: carol.cookie });
  check('a non-member does not receive the chat id', () => assert.equal(outsiderView.data.chatId, null));

  const outsiderRead = await api(`/api/squad-chats/${chatId}`, { cookie: carol.cookie });
  check('a non-member cannot read the chat', () => assert.equal(outsiderRead.status, 403));

  // ── Chat messaging ────────────────────────────────────────────────────────
  console.log('\n[squad chat]');
  await joinSquadChat(sockets.alice, chatId);
  await joinSquadChat(sockets.bob, chatId);

  const outsiderJoin = waitFor(sockets.carol, 'error_msg', (payload) => payload.code === 'FORBIDDEN');
  sockets.carol.emit('join_squad_chat', { chatId });
  const outsiderJoinPayload = await outsiderJoin;
  check('an outsider is refused the socket room', () => assert.ok(outsiderJoinPayload));

  const socketMessage = await sendViaSocket(sockets.bob, chatId, 'ready when you are');
  check('a member messages the squad over the socket', () => {
    assert.equal(socketMessage.text, 'ready when you are');
    assert.equal(socketMessage.author.username, 'bob');
  });

  // A REST insert must reach the open socket room just like a socket send does.
  const broadcast = waitFor(sockets.alice, 'squad_message', (message) => message.text === 'broadcast check');
  await api(`/api/squad-chats/${chatId}/messages`, {
    method: 'POST', cookie: bob.cookie, body: { text: 'broadcast check' }
  });
  const broadcastPayload = await broadcast;
  check('the room broadcasts to the other participant', () => assert.ok(broadcastPayload));

  const restSent = await api(`/api/squad-chats/${chatId}/messages`, {
    method: 'POST',
    cookie: bob.cookie,
    body: { text: 'second message' }
  });
  check('the REST path writes the same thread', () => {
    assert.equal(restSent.status, 201, JSON.stringify(restSent.data));
    assert.equal(restSent.data.message.text, 'second message');
  });

  const history = await api(`/api/squad-chats/${chatId}/messages`, { cookie: alice.cookie });
  check('history is readable and ordered', () => {
    assert.equal(history.status, 200);
    assert.ok(history.data.items.length >= 2);
    const times = history.data.items.map((item) => new Date(item.createdAt).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  });

  const emptyMessage = await api(`/api/squad-chats/${chatId}/messages`, {
    method: 'POST', cookie: bob.cookie, body: { text: '   ' }
  });
  check('an empty message is rejected', () => assert.equal(emptyMessage.status, 400));

  const outsiderSend = await api(`/api/squad-chats/${chatId}/messages`, {
    method: 'POST', cookie: carol.cookie, body: { text: 'let me in' }
  });
  check('a non-member cannot post', () => assert.equal(outsiderSend.status, 403));

  // ── Rolling refresh ───────────────────────────────────────────────────────
  const memberRefresh = await api(`/api/squad-chats/${chatId}/refresh`, { method: 'POST', cookie: bob.cookie });
  check('a member cannot extend the chat', () => assert.equal(memberRefresh.status, 403));

  const before = new Date(locked.data.chat.expiresAt).getTime();
  const refreshed = await api(`/api/squad-chats/${chatId}/refresh`, { method: 'POST', cookie: alice.cookie });
  check('the leader extends the chat by 15 days', () => {
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.data));
    assert.ok(new Date(refreshed.data.chat.expiresAt).getTime() >= before);
    assert.equal(refreshed.data.chat.refreshCount, 1);
    assert.equal(refreshed.data.chat.canRefresh, true);
  });

  // ── Leaving evicts immediately ────────────────────────────────────────────
  console.log('\n[departure]');
  const leaderLeave = await api(`/api/lfg/${squadId}/leave`, { method: 'POST', cookie: alice.cookie });
  check('the leader must close rather than leave', () => assert.equal(leaderLeave.status, 400));

  const evicted = waitFor(sockets.bob, 'squad_chat_evicted', (payload) => String(payload.chatId) === String(chatId));
  const left = await api(`/api/lfg/${squadId}/leave`, { method: 'POST', cookie: bob.cookie });
  check('a member leaves the squad', () => assert.equal(left.status, 200, JSON.stringify(left.data)));

  const evictedPayload = await evicted;
  check('the departed member is pushed out of the room', () => assert.ok(evictedPayload));

  const afterLeave = await SquadChat.findById(chatId).lean();
  check('the chat membership no longer includes them', () => {
    assert.deepEqual(afterLeave.memberIds.map(String), [alice.id]);
  });

  const readAfterLeave = await api(`/api/squad-chats/${chatId}`, { cookie: bob.cookie });
  check('their access is revoked server-side', () => assert.equal(readAfterLeave.status, 403));

  // ── Request-time expiry, with the sweep stopped ───────────────────────────
  console.log('\n[expiry]');
  const expiredAt = new Date(Date.now() - 1000);
  await SquadChat.updateOne({ _id: chatId }, { $set: { expiresAt: expiredAt } });

  const expiredRead = await api(`/api/squad-chats/${chatId}`, { cookie: alice.cookie });
  check('an expired chat is refused on read', () => {
    assert.equal(expiredRead.status, 403);
    assert.match(expiredRead.data.message, /expired/i);
  });

  const expiredSend = await api(`/api/squad-chats/${chatId}/messages`, {
    method: 'POST', cookie: alice.cookie, body: { text: 'too late' }
  });
  check('an expired chat is refused on write', () => assert.equal(expiredSend.status, 403));

  const expiredRefresh = await api(`/api/squad-chats/${chatId}/refresh`, { method: 'POST', cookie: alice.cookie });
  check('an expired chat cannot be revived', () => assert.equal(expiredRefresh.status, 403));

  const socketExpired = waitFor(sockets.alice, 'error_msg', (payload) => payload.code === 'FORBIDDEN');
  resetChatTrackers();
  sockets.alice.emit('send_squad_message', { chatId, text: 'still here?' });
  const socketExpiredPayload = await socketExpired;
  check('the socket enforces the same expiry', () => assert.ok(socketExpiredPayload));

  const swept = await purgeExpiredSquadChats();
  const sweptChat = await SquadChat.findById(chatId).lean();
  const sweptMessages = await SquadChatMessage.countDocuments({ chatId });
  check('the retention sweep expires the chat and purges its messages', () => {
    assert.equal(swept.chats, 1, JSON.stringify(swept));
    assert.equal(sweptChat.state, 'expired');
    assert.equal(sweptMessages, 0);
  });

  // ── Auto-lock when the last seat fills ────────────────────────────────────
  console.log('\n[auto-lock]');
  const small = await api('/api/lfg', {
    method: 'POST', cookie: alice.cookie, body: { gameTitle: 'Phase 8 Duo', maxSlots: 2 }
  });
  await api(`/api/lfg/${small.data._id}/request`, { method: 'POST', cookie: bob.cookie, body: {} });
  const filled = await api(`/api/lfg/${small.data._id}/respond`, {
    method: 'PATCH', cookie: alice.cookie, body: { userId: bob.id, action: 'accept' }
  });
  check('filling the last seat locks the squad and opens the chat', () => {
    assert.equal(filled.status, 200, JSON.stringify(filled.data));
    assert.equal(filled.data.party.state, 'locked');
    assert.equal(filled.data.party.status, 'full');
    assert.ok(filled.data.party.chatId, 'chat id attached');
    assert.equal(filled.data.party.chat.state, 'active');
  });

  const duoChatId = filled.data.party.chatId;

  const reopen = await api(`/api/lfg/${small.data._id}/unlock`, { method: 'POST', cookie: alice.cookie });
  check('the leader can reopen recruiting without destroying the chat', () => {
    assert.equal(reopen.status, 200, JSON.stringify(reopen.data));
    assert.equal(reopen.data.party.state, 'recruiting');
    assert.equal(reopen.data.party.status, 'open');
    assert.equal(reopen.data.party.chatId, duoChatId);
  });

  // ── Invitations ───────────────────────────────────────────────────────────
  console.log('\n[invitations]');
  const invite = await api('/api/invitations', {
    method: 'POST',
    cookie: alice.cookie,
    body: { recipientUserId: carol.id, targetType: 'squad', targetId: squadId, message: 'join us' }
  });
  check('the leader invites a player', () => {
    assert.equal(invite.status, 201, JSON.stringify(invite.data));
    assert.equal(invite.data.status, 'pending');
    assert.equal(invite.data.targetName, 'Phase 8 Arena');
  });

  const duplicate = await api('/api/invitations', {
    method: 'POST',
    cookie: alice.cookie,
    body: { recipientUserId: carol.id, targetType: 'squad', targetId: squadId }
  });
  check('a duplicate pending invitation is refused', () => assert.equal(duplicate.status, 409));

  const memberInvite = await api('/api/invitations', {
    method: 'POST',
    cookie: bob.cookie,
    body: { recipientUserId: dave.id, targetType: 'squad', targetId: small.data._id }
  });
  check('a non-leader cannot invite to a squad', () => assert.equal(memberInvite.status, 403));

  const inbox = await api('/api/invitations/inbox', { cookie: carol.cookie });
  check('the recipient sees the invitation', () => {
    assert.equal(inbox.status, 200);
    assert.equal(inbox.data.items.length, 1);
    assert.equal(inbox.data.items[0].inviter.username, 'alice');
  });

  const hijack = await api(`/api/invitations/${inbox.data.items[0]._id}/accept`, {
    method: 'POST', cookie: dave.cookie
  });
  check('somebody else cannot accept it', () => assert.equal(hijack.status, 404));

  const lockedDown = await api('/api/users/privacy-settings', {
    method: 'PATCH', cookie: carol.cookie, body: { allowSquadInvites: 'none' }
  });
  check('privacy settings save', () => {
    assert.equal(lockedDown.status, 200, JSON.stringify(lockedDown.data));
    assert.equal(lockedDown.data.privacySettings.allowSquadInvites, 'none');
  });

  const refused = await api('/api/invitations', {
    method: 'POST',
    cookie: alice.cookie,
    body: { recipientUserId: carol.id, targetType: 'squad', targetId: small.data._id }
  });
  check('a recipient who accepts nobody cannot be invited', () => {
    assert.equal(refused.status, 403);
    assert.equal(refused.data.code, 'PRIVACY');
    assert.match(refused.data.message, /squad/i);
  });

  const badSetting = await api('/api/users/privacy-settings', {
    method: 'PATCH', cookie: carol.cookie, body: { allowSquadInvites: 'everybody' }
  });
  check('an invalid privacy value is rejected', () => assert.equal(badSetting.status, 400));

  await api('/api/users/privacy-settings', {
    method: 'PATCH', cookie: carol.cookie, body: { allowSquadInvites: 'anyone' }
  });

  const blocked = await api(`/api/account/block/${alice.id}`, { method: 'POST', cookie: carol.cookie });
  check('a player can block another', () => assert.equal(blocked.status, 200, JSON.stringify(blocked.data)));

  const blockedInvite = await api('/api/invitations', {
    method: 'POST',
    cookie: alice.cookie,
    body: { recipientUserId: carol.id, targetType: 'squad', targetId: small.data._id }
  });
  check('a blocked pair cannot be invited, and the reason is hidden', () => {
    assert.equal(blockedInvite.status, 403);
    assert.equal(blockedInvite.data.message, 'This player cannot be invited.');
  });

  const unblocked = await api(`/api/account/block/${alice.id}`, { method: 'DELETE', cookie: carol.cookie });
  check('a block can be lifted', () => assert.equal(unblocked.status, 200));

  const acceptedInvite = await api(`/api/invitations/${inbox.data.items[0]._id}/accept`, {
    method: 'POST', cookie: carol.cookie
  });
  check('the recipient accepts and joins the squad', () => {
    assert.equal(acceptedInvite.status, 200, JSON.stringify(acceptedInvite.data));
    assert.equal(acceptedInvite.data.status, 'accepted');
    assert.equal(acceptedInvite.data.targetType, 'squad');
  });

  const squadAfterAccept = await Party.findById(squadId).lean();
  const chatAfterAccept = await SquadChat.findById(chatId).lean();
  check('acceptance is the only way membership was granted', () => {
    assert.ok(squadAfterAccept.members.some((m) => String(m.userId) === carol.id));
    assert.ok(chatAfterAccept.memberIds.map(String).includes(carol.id));
  });

  const acceptAgain = await api(`/api/invitations/${inbox.data.items[0]._id}/accept`, {
    method: 'POST', cookie: carol.cookie
  });
  check('accepting twice is idempotent', () => {
    assert.equal(acceptAgain.status, 200);
    assert.equal(acceptAgain.data.alreadyAccepted, true);
  });

  const daveInvite = await api('/api/invitations', {
    method: 'POST',
    cookie: alice.cookie,
    body: { recipientUserId: dave.id, targetType: 'squad', targetId: small.data._id }
  });
  const daveInbox = await api('/api/invitations/inbox', { cookie: dave.cookie });
  const daveInviteId = daveInbox.data.items.find((item) => item.targetType === 'squad')?._id;

  const declined = await api(`/api/invitations/${daveInviteId}/decline`, {
    method: 'POST', cookie: dave.cookie
  });
  check('an invitation can be declined', () => {
    assert.equal(daveInvite.status, 201, JSON.stringify(daveInvite.data));
    assert.equal(declined.status, 200);
    assert.equal(declined.data.status, 'declined');
  });

  const secondInvite = await api('/api/invitations', {
    method: 'POST',
    cookie: alice.cookie,
    body: { recipientUserId: dave.id, targetType: 'squad', targetId: small.data._id }
  });
  const revoked = await api(`/api/invitations/${secondInvite.data._id}/revoke`, {
    method: 'POST', cookie: alice.cookie
  });
  check('an inviter can revoke a pending invitation', () => {
    assert.equal(secondInvite.status, 201, JSON.stringify(secondInvite.data));
    assert.equal(revoked.status, 200);
    assert.equal(revoked.data.status, 'revoked');
  });

  // ── Squad → server migration ──────────────────────────────────────────────
  console.log('\n[server migration]');
  const serverRes = await api('/api/communities', {
    method: 'POST', cookie: alice.cookie, body: { name: 'Phase Eight HQ', description: 'migration target' }
  });
  check('a server exists to migrate into', () => assert.equal(serverRes.status, 201, JSON.stringify(serverRes.data)));

  const communityId = serverRes.data._id;

  const migration = await api(`/api/lfg/${small.data._id}/server-migration`, {
    method: 'POST', cookie: alice.cookie, body: { communityId }
  });
  check('migration creates invitations, never memberships', () => {
    assert.equal(migration.status, 200, JSON.stringify(migration.data));
    assert.ok(migration.data.invited >= 1, 'at least one member was invited');
    assert.equal(migration.data.skipped.every((row) => row.reason), true);
  });

  const preMigration = await Community.findById(communityId).lean();
  check('nobody was silently added to the server', () => {
    assert.deepEqual(preMigration.members.map((m) => String(m.userId)), [alice.id]);
  });

  // The squad's other member is the one with a server invitation to accept.
  const memberInbox = await api('/api/invitations/inbox', { cookie: bob.cookie });
  const communityInvite = memberInbox.data.items.find((item) => item.targetType === 'community_server');
  check('the migration produced a pending server invitation', () => assert.ok(communityInvite));

  const joinedServer = await api(`/api/invitations/${communityInvite._id}/accept`, {
    method: 'POST', cookie: bob.cookie
  });
  check('each member accepts the server invitation individually', () => {
    assert.equal(joinedServer.status, 200, JSON.stringify(joinedServer.data));
    assert.equal(joinedServer.data.targetType, 'community_server');
  });

  const postMigration = await Community.findById(communityId).lean();
  check('only the accepting member joined', () => {
    const ids = postMigration.members.map((m) => String(m.userId)).sort();
    assert.deepEqual(ids, [alice.id, bob.id].sort());
  });

  // ── Blocking in search ────────────────────────────────────────────────────
  console.log('\n[blocking]');
  await api(`/api/account/block/${carol.id}`, { method: 'POST', cookie: bob.cookie });

  const searchBlocked = await api('/api/users/search?q=carol', { cookie: bob.cookie });
  check('a blocked player disappears from the blocker search', () => {
    assert.equal(searchBlocked.status, 200);
    assert.equal(searchBlocked.data.users.length, 0);
  });

  const searchReverse = await api('/api/users/search?q=bob', { cookie: carol.cookie });
  check('blocking is symmetric in search', () => assert.equal(searchReverse.data.users.length, 0));

  await api(`/api/account/block/${carol.id}`, { method: 'DELETE', cookie: bob.cookie });
  const searchUnblocked = await api('/api/users/search?q=carol', { cookie: bob.cookie });
  check('unblocking restores visibility', () => {
    assert.equal(searchUnblocked.data.users.length, 1);
    assert.equal(searchUnblocked.data.users[0].username, 'carol');
  });

  // ── Data export ───────────────────────────────────────────────────────────
  console.log('\n[data rights]');
  const exported = await api('/api/account/data-export', { cookie: bob.cookie, raw: true });
  const exportBody = JSON.parse(exported.text);
  check('the export is a downloadable JSON package', () => {
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-disposition') || '', /attachment/);
    assert.equal(exportBody.account.username, 'bob');
    assert.ok(Array.isArray(exportBody.squads.parties));
    assert.ok(exportBody.invitations && Array.isArray(exportBody.invitations.received));
  });

  check('the export never contains a password hash or session secret', () => {
    assert.equal(exported.text.includes('passwordHash'), false);
    assert.equal(exported.text.includes('erased$'), false);
    assert.equal(exported.text.includes('JWT_SECRET'), false);
  });

  // ── Session revocation ────────────────────────────────────────────────────
  console.log('\n[sessions]');
  const revokedSessions = await api('/api/auth/logout-all', { method: 'POST', cookie: alice.cookie });
  check('sign out everywhere bumps the session version', () => {
    assert.equal(revokedSessions.status, 200, JSON.stringify(revokedSessions.data));
    assert.equal(typeof revokedSessions.data.sessionVersion, 'number');
  });

  const staleMe = await api('/api/auth/me', { cookie: alice.cookie });
  check('the old cookie stops working', () => assert.equal(staleMe.status, 401));

  const relogin = await api('/api/auth/login', {
    method: 'POST', body: { email: 'alice@example.com', password: 'password123' }
  });
  check('a fresh sign-in works after revocation', () => {
    assert.equal(relogin.status, 200, JSON.stringify(relogin.data));
    assert.ok(relogin.cookie);
  });

  alice.cookie = relogin.cookie;
  const freshMe = await api('/api/auth/me', { cookie: alice.cookie });
  check('the new session is usable', () => assert.equal(freshMe.status, 200));

  // ── Account deletion ──────────────────────────────────────────────────────
  console.log('\n[deletion]');
  const deletion = await api('/api/account/deletion-request', { method: 'POST', cookie: dave.cookie });
  check('a deletion request schedules erasure', () => {
    assert.equal(deletion.status, 200, JSON.stringify(deletion.data));
    assert.equal(deletion.data.status, 'deletion_pending');
    assert.equal(deletion.data.graceDays, 30);
  });

  const daveStale = await api('/api/auth/me', { cookie: dave.cookie });
  check('the deletion request revokes the current session', () => assert.equal(daveStale.status, 401));

  const daveRelogin = await api('/api/auth/login', {
    method: 'POST', body: { email: 'dave@example.com', password: 'password123' }
  });
  check('the owner can sign back in during the grace period', () => assert.equal(daveRelogin.status, 200));

  dave.cookie = daveRelogin.cookie;
  const accountState = await api('/api/account', { cookie: dave.cookie });
  check('the account reports the pending deletion', () => {
    assert.equal(accountState.status, 200, JSON.stringify(accountState.data));
    assert.equal(accountState.data.status, 'deletion_pending');
  });

  const cancelledDeletion = await api('/api/account/deletion-cancel', { method: 'POST', cookie: dave.cookie });
  check('deletion can be cancelled inside the grace period', () => {
    assert.equal(cancelledDeletion.status, 200, JSON.stringify(cancelledDeletion.data));
    assert.equal(cancelledDeletion.data.status, 'active');
    assert.ok(cancelledDeletion.data.token);
  });

  await User.updateOne(
    { _id: dave.id },
    { $set: { status: 'deletion_pending', deletionRequestedAt: new Date(Date.now() - 31 * DAY_MS) } }
  );
  const erased = await eraseDeletionPendingUsers();
  const erasedUser = await User.findById(dave.id).lean();
  check('the sweep erases an account past its grace period', () => {
    assert.ok(erased >= 1, `erased ${erased}`);
    assert.equal(erasedUser.status, 'deleted');
    assert.match(erasedUser.username, /^deleted_/);
    assert.match(erasedUser.email, /@deleted\.invalid$/);
    assert.deepEqual(erasedUser.authIdentities, []);
  });

  const erasedLogin = await api('/api/auth/login', {
    method: 'POST', body: { email: 'dave@example.com', password: 'password123' }
  });
  check('an erased account cannot sign in', () => assert.equal(erasedLogin.status, 401));

  // ── Provider surface & readiness ──────────────────────────────────────────
  console.log('\n[providers]');
  const providers = await api('/api/auth/providers');
  check('sign-in providers are discoverable', () => {
    assert.equal(providers.status, 200);
    assert.equal(typeof providers.data.google.enabled, 'boolean');
  });

  const googleWithoutCredential = await api('/api/auth/google', { method: 'POST', body: {} });
  check('Google sign-in fails closed without a credential', () => {
    assert.ok([400, 503].includes(googleWithoutCredential.status), String(googleWithoutCredential.status));
  });

  const health = await api('/api/health');
  check('readiness reports every domain', () => {
    assert.equal(health.status, 200, JSON.stringify(health.data));
    assert.equal(health.data.domains.auth, 'connected');
    assert.equal(health.data.domains.communities, 'connected');
    assert.equal(typeof health.data.domains.squads, 'string');
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
