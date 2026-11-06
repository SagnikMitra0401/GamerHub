/**
 * Phase 11 end-to-end verification — private 1:1 messaging consent core.
 *
 * Runs against a THROWAWAY database on the same cluster:
 *   node scripts/e2e-phase11.js
 *
 * Proves the parts a pure policy test cannot: the request/accept state machine,
 * participant-only reads, live socket delivery, decline cooldowns, blocks,
 * per-viewer profile projections and the report record.
 */
require('dotenv').config();
const http = require('http');
const assert = require('assert/strict');
const mongoose = require('mongoose');

const E2E_DB = `gamerhub_e2e11_${Date.now().toString(36)}`;

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
process.env.DM_READ_RATE_LIMIT_MAX = '1000';
process.env.DM_WRITE_RATE_LIMIT_MAX = '1000';
process.env.DM_REQUEST_RATE_LIMIT_MAX = '1000';
process.env.DM_SETTINGS_RATE_LIMIT_MAX = '1000';
process.env.SOCKET_JOIN_RATE_MAX = '1000';
process.env.DISABLE_RETENTION_WORKER = '1';

const connectDB = require('../server/config/db');
const app = require('../server/app');
const { initSocket } = require('../server/config/socket');
const { closeDomainConnections } = require('../server/config/connections');

const Conversation = require('../server/models/Conversation');
const DmReport = require('../server/models/DmReport');

const { api, check, connectSocket, registerUser, report, setBase, waitFor } = require('./lib/e2e-harness');

async function scenarios({ alice, bob, carol, dave, sockets }) {
  // ── public projection ────────────────────────────────────────────────────
  const publicProfile = await api('/api/users/dm11alice', { cookie: carol.cookie });
  check('a stranger sees the one DM row that applies to them', () => {
    assert.equal(publicProfile.status, 200, JSON.stringify(publicProfile.data));
    assert.equal(publicProfile.data.dm.mode, 'request');
    assert.equal(publicProfile.data.dm.allowed, true);
  });
  check('the full consent matrix is not exposed on a profile', () => {
    assert.equal(publicProfile.data.dmSettings, undefined);
  });

  // ── request ──────────────────────────────────────────────────────────────
  const firstText = 'Hey, I saw your Valorant clips. Want to queue?';
  const request = await api('/api/messages/requests', {
    method: 'POST',
    cookie: bob.cookie,
    body: {
      recipientId: alice.id,
      text: firstText,
      context: { type: 'profile' }
    }
  });
  check('a stranger can create a pending request', () => {
    assert.equal(request.status, 201, JSON.stringify(request.data));
    assert.equal(request.data.direct, false);
    assert.equal(request.data.conversation.state, 'request');
  });
  const conversationId = String(request.data.conversation._id);

  const aliceSummary = await api('/api/messages/summary', { cookie: alice.cookie });
  check('a request raises the recipient inbox count', () => {
    assert.equal(aliceSummary.status, 200, JSON.stringify(aliceSummary.data));
    assert.equal(aliceSummary.data.requests, 1);
    assert.equal(aliceSummary.data.unread, 0);
  });

  const bobSent = await api('/api/messages/conversations?folder=sent', { cookie: bob.cookie });
  check('the sender can see their outgoing request', () => {
    assert.equal(bobSent.status, 200, JSON.stringify(bobSent.data));
    assert.ok(bobSent.data.items.some((item) => item._id === conversationId));
  });

  const idor = await api(`/api/messages/conversations/${conversationId}`, { cookie: carol.cookie });
  check('a non-participant cannot read the conversation by id', () => {
    assert.equal(idor.status, 404, JSON.stringify(idor.data));
  });

  const bobView = await api(`/api/messages/conversations/${conversationId}`, { cookie: bob.cookie });
  check('the sender sees the pending opener and no message history', () => {
    assert.equal(bobView.status, 200, JSON.stringify(bobView.data));
    assert.equal(bobView.data.conversation.request.text, firstText);
    assert.equal(bobView.data.messages.length, 0);
  });

  const notifications = await api('/api/notifications?limit=20', { cookie: alice.cookie });
  check('a pending request never pushes a notification', () => {
    assert.equal(notifications.status, 200, JSON.stringify(notifications.data));
    const items = notifications.data.items || [];
    assert.equal(items.some((item) => item.metadata?.kind === 'dm_message'), false);
  });

  const accept = await api(`/api/messages/conversations/${conversationId}/accept`, {
    method: 'POST',
    cookie: alice.cookie
  });
  check('the recipient can accept the request', () => {
    assert.equal(accept.status, 200, JSON.stringify(accept.data));
    assert.equal(accept.data.conversation.state, 'active');
  });

  const acceptedThread = await api(`/api/messages/conversations/${conversationId}`, { cookie: alice.cookie });
  check('accepting turns the opener into the first message', () => {
    assert.equal(acceptedThread.status, 200, JSON.stringify(acceptedThread.data));
    assert.equal(acceptedThread.data.messages.length, 1);
    assert.equal(acceptedThread.data.messages[0].text, firstText);
  });

  // ── live delivery ────────────────────────────────────────────────────────
  const aliceJoined = waitFor(
    sockets.alice,
    'joined_conversation',
    (payload) => String(payload.conversationId) === conversationId
  );
  sockets.alice.emit('join_conversation', { conversationId });
  const aliceJoinPayload = await aliceJoined;
  check('the recipient joins the live conversation room', () => assert.ok(aliceJoinPayload));

  const bobJoined = waitFor(
    sockets.bob,
    'joined_conversation',
    (payload) => String(payload.conversationId) === conversationId
  );
  sockets.bob.emit('join_conversation', { conversationId });
  const bobJoinPayload = await bobJoined;
  check('the sender joins the live conversation room', () => assert.ok(bobJoinPayload));

  const bobText = 'I main Jett. What time do you queue?';
  const aliceArrival = waitFor(
    sockets.alice,
    'dm_message',
    (payload) => String(payload?.conversation?._id) === conversationId && payload?.message?.text === bobText,
    6000
  );
  const sent = await api(`/api/messages/conversations/${conversationId}/messages`, {
    method: 'POST',
    cookie: bob.cookie,
    body: { text: bobText }
  });
  check('an accepted thread accepts a reply', () => {
    assert.equal(sent.status, 201, JSON.stringify(sent.data));
    assert.equal(sent.data.message.text, bobText);
  });
  const delivered = await aliceArrival;
  check('the reply reaches the other participant over the socket', () => {
    assert.ok(delivered, 'no dm_message event');
    assert.equal(delivered.message.text, bobText);
  });

  const unreadSummary = await api('/api/messages/summary', { cookie: alice.cookie });
  check('an incoming reply raises the unread count', () => {
    assert.equal(unreadSummary.data.unread, 1, JSON.stringify(unreadSummary.data));
  });

  const read = await api(`/api/messages/conversations/${conversationId}/read`, {
    method: 'POST',
    cookie: alice.cookie
  });
  check('opening a thread can clear its unread count', () => assert.equal(read.status, 200));
  const readSummary = await api('/api/messages/summary', { cookie: alice.cookie });
  check('the cleared count is reflected in the inbox summary', () => {
    assert.equal(readSummary.data.unread, 0, JSON.stringify(readSummary.data));
  });

  const aliceText = 'Tonight, 8pm. I will send the lobby link in-game.';
  const bobArrival = waitFor(
    sockets.bob,
    'dm_message',
    (payload) => String(payload?.conversation?._id) === conversationId && payload?.message?.text === aliceText,
    6000
  );
  const reply = await api(`/api/messages/conversations/${conversationId}/messages`, {
    method: 'POST',
    cookie: alice.cookie,
    body: { text: aliceText }
  });
  check('the recipient can reply in the accepted thread', () => assert.equal(reply.status, 201, JSON.stringify(reply.data)));
  const bobReceived = await bobArrival;
  check('the reply reaches the sender over the socket', () => assert.ok(bobReceived));

  const socketIdor = waitFor(
    sockets.carol,
    'error_msg',
    (payload) => payload?.code === 'NOT_FOUND',
    5000
  );
  sockets.carol.emit('join_conversation', { conversationId });
  const socketRefusal = await socketIdor;
  check('a non-participant cannot subscribe to the live room', () => assert.ok(socketRefusal));

  // ── decline and cooldown ─────────────────────────────────────────────────
  const carolRequest = await api('/api/messages/requests', {
    method: 'POST',
    cookie: carol.cookie,
    body: { recipientId: bob.id, text: 'Hi Bob, want to play some ranked?' }
  });
  check('a second player can send a request', () => {
    assert.equal(carolRequest.status, 201, JSON.stringify(carolRequest.data));
    assert.equal(carolRequest.data.direct, false);
  });
  const carolConversationId = String(carolRequest.data.conversation._id);

  const bobRequests = await api('/api/messages/conversations?folder=requests', { cookie: bob.cookie });
  check('the recipient sees the new request in the request lane', () => {
    assert.equal(bobRequests.status, 200, JSON.stringify(bobRequests.data));
    assert.ok(bobRequests.data.items.some((item) => item._id === carolConversationId));
  });

  const decline = await api(`/api/messages/conversations/${carolConversationId}/request`, {
    method: 'DELETE',
    cookie: bob.cookie
  });
  check('the recipient can decline a request silently', () => {
    assert.equal(decline.status, 200, JSON.stringify(decline.data));
    assert.equal(decline.data.conversation.state, 'declined');
  });

  const retryAfterDecline = await api('/api/messages/requests', {
    method: 'POST',
    cookie: carol.cookie,
    body: { recipientId: bob.id, text: 'Trying again too soon.' }
  });
  check('a declined sender is held to the 90-day cooldown', () => {
    assert.equal(retryAfterDecline.status, 403, JSON.stringify(retryAfterDecline.data));
    assert.match(String(retryAfterDecline.data?.message || ''), /cannot message this player yet/i);
  });

  const block = await api(`/api/account/block/${carol.id}`, {
    method: 'POST',
    cookie: bob.cookie
  });
  check('the recipient can block the sender', () => assert.equal(block.status, 200, JSON.stringify(block.data)));

  const afterBlock = await api('/api/messages/requests', {
    method: 'POST',
    cookie: carol.cookie,
    body: { recipientId: bob.id, text: 'One more try.' }
  });
  check('a blocked sender cannot create a new request', () => {
    assert.equal(afterBlock.status, 403, JSON.stringify(afterBlock.data));
    assert.match(String(afterBlock.data?.message || ''), /cannot message this player/i);
  });

  // ── policy changes and profile projection ────────────────────────────────
  const daveBefore = await api('/api/users/dm11dave', { cookie: carol.cookie });
  check('a different stranger starts on the request policy', () => {
    assert.equal(daveBefore.status, 200, JSON.stringify(daveBefore.data));
    assert.equal(daveBefore.data.dm.mode, 'request');
  });

  const linkRefusal = await api('/api/messages/requests', {
    method: 'POST',
    cookie: carol.cookie,
    body: { recipientId: dave.id, text: 'Check https://example.com for my clips.' }
  });
  check('a first message may not carry a link', () => {
    assert.equal(linkRefusal.status, 400, JSON.stringify(linkRefusal.data));
    assert.match(String(linkRefusal.data?.message || ''), /links/i);
  });

  const matrixPatch = await api('/api/account/dm-settings', {
    method: 'PATCH',
    cookie: dave.cookie,
    body: { policy: { stranger: 'none' } }
  });
  check('a player can close their stranger inbox from settings', () => {
    assert.equal(matrixPatch.status, 200, JSON.stringify(matrixPatch.data));
    assert.equal(matrixPatch.data.dmSettings.policy.stranger, 'none');
  });

  const daveAfter = await api('/api/users/dm11dave', { cookie: carol.cookie });
  check('the public profile reflects the closed stranger inbox', () => {
    assert.equal(daveAfter.status, 200, JSON.stringify(daveAfter.data));
    assert.equal(daveAfter.data.dm.mode, 'none');
    assert.equal(daveAfter.data.dm.allowed, false);
    assert.equal(daveAfter.data.dmSettings, undefined);
  });

  const closedInbox = await api('/api/messages/requests', {
    method: 'POST',
    cookie: carol.cookie,
    body: { recipientId: dave.id, text: 'Hello anyway.' }
  });
  check('the server refuses a request the policy has closed', () => {
    assert.equal(closedInbox.status, 403, JSON.stringify(closedInbox.data));
    assert.match(String(closedInbox.data?.message || ''), /not accepting messages/i);
  });

  const selfProfile = await api('/api/users/dm11dave', { cookie: dave.cookie });
  check('a profile labels the owner without exposing a contact row', () => {
    assert.equal(selfProfile.status, 200, JSON.stringify(selfProfile.data));
    assert.equal(selfProfile.data.dm.mode, 'self');
  });

  // ── mutual direct inbox ──────────────────────────────────────────────────
  const bobFollowsDave = await api('/api/users/dm11dave/follow', { method: 'POST', cookie: bob.cookie });
  const daveFollowsBob = await api('/api/users/dm11bob/follow', { method: 'POST', cookie: dave.cookie });
  check('both accounts can follow each other', () => {
    assert.equal(bobFollowsDave.status, 200, JSON.stringify(bobFollowsDave.data));
    assert.equal(daveFollowsBob.status, 200, JSON.stringify(daveFollowsBob.data));
  });

  const direct = await api('/api/messages/requests', {
    method: 'POST',
    cookie: dave.cookie,
    body: { recipientId: bob.id, text: 'Mutuals should be able to talk directly.' }
  });
  check('a mutual with an open inbox gets a direct thread, not a request', () => {
    assert.equal(direct.status, 201, JSON.stringify(direct.data));
    assert.equal(direct.data.direct, true);
    assert.equal(direct.data.conversation.state, 'active');
  });

  // ── expiry ───────────────────────────────────────────────────────────────
  // Alice has not sent a request yet, so she still has her new-account quota.
  // Carol already spent hers on the request to Bob (the policy is one per day
  // until an account is a week old).
  const expiryRequest = await api('/api/messages/requests', {
    method: 'POST',
    cookie: alice.cookie,
    body: { recipientId: carol.id, text: 'An opener that will never be answered.' }
  });
  check('a request can be created for the expiry probe', () => {
    assert.equal(expiryRequest.status, 201, JSON.stringify(expiryRequest.data));
  });
  const expiryId = String(expiryRequest.data.conversation._id);
  await Conversation.updateOne(
    { _id: expiryId },
    { $set: { requestExpiresAt: new Date(Date.now() - 1000) } }
  );

  const expiredAccept = await api(`/api/messages/conversations/${expiryId}/accept`, {
    method: 'POST',
    cookie: carol.cookie
  });
  check('an expired request cannot be accepted', () => {
    assert.equal(expiredAccept.status, 403, JSON.stringify(expiredAccept.data));
    assert.match(String(expiredAccept.data?.message || ''), /expired/i);
  });

  const retryAfterExpiry = await api('/api/messages/requests', {
    method: 'POST',
    cookie: alice.cookie,
    body: { recipientId: carol.id, text: 'Trying again after an ignored request.' }
  });
  check('an ignored request starts the same cooldown', () => {
    assert.equal(retryAfterExpiry.status, 403, JSON.stringify(retryAfterExpiry.data));
    assert.match(String(retryAfterExpiry.data?.message || ''), /cannot message this player yet/i);
  });

  // ── report and block ─────────────────────────────────────────────────────
  const reportResult = await api(`/api/messages/conversations/${conversationId}/report`, {
    method: 'POST',
    cookie: alice.cookie,
    body: { reason: 'spam', note: 'E2E report probe', block: true }
  });
  check('reporting records the report and blocks the thread', () => {
    assert.equal(reportResult.status, 201, JSON.stringify(reportResult.data));
    assert.equal(reportResult.data.reported, true);
    assert.equal(reportResult.data.blocked, true);
  });

  const reportRows = await DmReport.countDocuments({ conversationId });
  check('the report is stored for moderation', () => assert.equal(reportRows, 1));

  const blockedRecord = await Conversation.findById(conversationId).lean();
  check('the blocked conversation leaves the active state', () => {
    assert.equal(blockedRecord.state, 'blocked');
    assert.equal(String(blockedRecord.blockedBy), String(alice.id));
  });

  const afterReportInbox = await api('/api/messages/conversations?folder=inbox', { cookie: alice.cookie });
  check('a blocked thread disappears from the inbox', () => {
    assert.equal(afterReportInbox.status, 200, JSON.stringify(afterReportInbox.data));
    assert.equal(afterReportInbox.data.items.some((item) => item._id === conversationId), false);
  });

  const sendAfterBlock = await api(`/api/messages/conversations/${conversationId}/messages`, {
    method: 'POST',
    cookie: bob.cookie,
    body: { text: 'This must not be delivered.' }
  });
  check('a blocked thread refuses new messages', () => {
    assert.notEqual(sendAfterBlock.status, 201, JSON.stringify(sendAfterBlock.data));
  });

  // ── auth and self guard ──────────────────────────────────────────────────
  const anonymous = await api('/api/messages/summary');
  check('the inbox requires a session', () => assert.equal(anonymous.status, 401));

  const selfRequest = await api('/api/messages/requests', {
    method: 'POST',
    cookie: alice.cookie,
    body: { recipientId: alice.id, text: 'Note to self.' }
  });
  check('a player cannot message themselves', () => {
    assert.equal(selfRequest.status, 400, JSON.stringify(selfRequest.data));
    assert.match(String(selfRequest.data?.message || ''), /yourself/i);
  });
}

async function run() {
  await connectDB();
  console.log(`Using throwaway database: ${E2E_DB}`);

  const server = http.createServer(app);
  initSocket(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  setBase(`http://127.0.0.1:${server.address().port}`);

  const alice = await registerUser('dm11alice', { probeId: true });
  const bob = await registerUser('dm11bob', { probeId: true });
  const carol = await registerUser('dm11carol', { probeId: true });
  const dave = await registerUser('dm11dave', { probeId: true });

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

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
