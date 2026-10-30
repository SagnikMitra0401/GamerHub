/**
 * Phase 7 end-to-end verification.
 *
 * Runs against a THROWAWAY database on the same cluster:
 *   node scripts/e2e-phase7.js
 *
 * Covers the Discord-inspired surface added in phase 7: reactions, replies,
 * @mentions, pinned messages, permission-scoped search, forum channels, channel
 * attachments, timeouts, bans, reports and personal mutes.
 *
 * Every check is a cross-user or cross-channel check wherever that is the point
 * of the feature — a member must not be able to pin, search a private channel,
 * attach someone else's upload, reply inside a locked thread, or act on a peer.
 */
require('dotenv').config();
const http = require('http');
const assert = require('assert/strict');
const mongoose = require('mongoose');

const E2E_DB = `gamerhub_e2e7_${Date.now().toString(36)}`;

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
process.env.DISABLE_RETENTION_WORKER = '1';

const connectDB = require('../server/config/db');
const app = require('../server/app');
const { initSocket, resetChatTrackers } = require('../server/config/socket');

const Notification = require('../server/models/Notification');
const Attachment = require('../server/models/Attachment');
const AuditLog = require('../server/models/AuditLog');
const Message = require('../server/models/Message');
const ForumPost = require('../server/models/ForumPost');

const {
  api, check, connectSocket, registerUser, report, setBase, waitFor
} = require('./lib/e2e-harness');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll a predicate so async, fire-and-forget work (pings) can settle. */
async function waitUntil(fn, { timeoutMs = 4000, stepMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await sleep(stepMs);
  }
  return false;
}

async function joinChannel(socket, channelId) {
  const joined = waitFor(socket, 'joined_channel', (payload) => String(payload.channelId) === String(channelId));
  socket.emit('join_channel', { channelId });
  const result = await joined;
  assert.ok(result, `socket did not join channel ${channelId}`);
  return result;
}

async function sendMessage(socket, payload) {
  // The flood limiter is per user, 5 messages / 5 s. A test suite sends more
  // than that on purpose, so the tracker is reset per send.
  resetChatTrackers();
  const arrived = waitFor(socket, 'new_message', (message) => {
    if (payload.text) return message.text === payload.text;
    return Array.isArray(message.attachments) && message.attachments.length > 0;
  });
  socket.emit('send_message', payload);
  const message = await arrived;
  assert.ok(message, `message did not arrive: ${JSON.stringify(payload)}`);
  return message;
}

async function expectSendError(socket, payload, code) {
  resetChatTrackers();
  const error = waitFor(socket, 'error_msg', (payloadOut) => payloadOut.code === code);
  socket.emit('send_message', payload);
  const result = await error;
  assert.ok(result, `expected error code ${code}, got none`);
  return result;
}

async function run() {
  await connectDB();
  console.log(`Using throwaway database: ${E2E_DB}`);

  const server = http.createServer(app);
  initSocket(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  setBase(`http://127.0.0.1:${server.address().port}`);

  // Text search needs the schema's text indexes; on a fresh database they are
  // built asynchronously after the model is first used.
  await Message.init();
  await ForumPost.init();

  const alice = await registerUser('alice', { probeId: true }); // owner
  const bob = await registerUser('bob', { probeId: true });     // member
  const carol = await registerUser('carol', { probeId: true }); // moderator
  const dave = await registerUser('dave', { probeId: true });   // member
  const eve = await registerUser('eve', { probeId: true });     // outsider

  const sockets = {
    alice: await connectSocket(alice.token),
    bob: await connectSocket(bob.token),
    carol: await connectSocket(carol.token),
    dave: await connectSocket(dave.token)
  };

  try {
    await scenarios({ alice, bob, carol, dave, eve, sockets });
  } finally {
    for (const socket of Object.values(sockets)) socket.disconnect();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    server.close();
  }

  const failed = report();
  if (failed.length) process.exit(1);
}

async function scenarios({ alice, bob, carol, dave, eve, sockets }) {
  // ── Setup ────────────────────────────────────────────────────────────────
  console.log('\n[setup]');
  const created = await api('/api/communities', {
    method: 'POST',
    cookie: alice.cookie,
    body: { name: 'Phase Seven HQ', description: 'phase 7 sandbox' }
  });
  check('community created', () => assert.equal(created.status, 201, JSON.stringify(created.data)));

  const communityId = created.data._id;
  const slug = created.data.slug;

  const generalChannel = await api(`/api/communities/${communityId}/channels`, {
    method: 'POST',
    cookie: alice.cookie,
    body: { name: 'lobby' }
  });
  check('text channel created', () => assert.equal(generalChannel.status, 201, JSON.stringify(generalChannel.data)));
  const generalId = generalChannel.data._id;

  const secretChannel = await api(`/api/communities/${communityId}/channels`, {
    method: 'POST',
    cookie: alice.cookie,
    body: { name: 'secret', minRoleToRead: 'admin', minRoleToWrite: 'admin' }
  });
  check('admin-only channel created', () => assert.equal(secretChannel.status, 201, JSON.stringify(secretChannel.data)));
  const secretId = secretChannel.data._id;

  const forumChannel = await api(`/api/communities/${communityId}/channels`, {
    method: 'POST',
    cookie: alice.cookie,
    body: { name: 'help-desk', type: 'forum' }
  });
  check('forum channel created', () => {
    assert.equal(forumChannel.status, 201, JSON.stringify(forumChannel.data));
    assert.equal(forumChannel.data.type, 'forum');
  });
  const forumId = forumChannel.data._id;

  for (const user of [bob, carol, dave]) {
    const joined = await api(`/api/communities/${communityId}/join`, { method: 'POST', cookie: user.cookie });
    check(`${user.username} joined`, () => assert.equal(joined.status, 200, JSON.stringify(joined.data)));
  }

  const promoted = await api(`/api/communities/${communityId}/members/${carol.id}/role`, {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { newRole: 'moderator' }
  });
  check('carol promoted to moderator', () => assert.equal(promoted.status, 200, JSON.stringify(promoted.data)));

  await joinChannel(sockets.bob, generalId);
  await joinChannel(sockets.carol, generalId);
  await joinChannel(sockets.dave, generalId);

  // ── Mentions + replies ───────────────────────────────────────────────────
  console.log('\n[mentions & replies]');
  const mentionMessage = await sendMessage(sockets.bob, {
    channelId: generalId,
    text: 'gg squad @alice @carol and @nobody-here'
  });

  check('mentions resolve to real members only', () => {
    const names = mentionMessage.mentions.map((mention) => mention.username).sort();
    assert.deepEqual(names, ['alice', 'carol']);
  });

  const alicePinged = await waitUntil(async () =>
    (await Notification.countDocuments({ userId: alice.id, title: /mentioned you/ })) === 1
  );
  check('alice received exactly one mention notification', () => assert.equal(alicePinged, true));

  const carolPinged = await waitUntil(async () =>
    (await Notification.countDocuments({ userId: carol.id, title: /mentioned you/ })) === 1
  );
  check('carol received a mention notification', () => assert.equal(carolPinged, true));

  const eveNotPinged = await Notification.exists({ userId: eve.id });
  check('non-members are never pinged', () => assert.equal(eveNotPinged, null));

  const reply = await sendMessage(sockets.bob, {
    channelId: generalId,
    text: 'replying to myself',
    replyTo: { messageId: mentionMessage._id }
  });
  check('reply keeps a preview of the original', () => {
    assert.equal(reply.replyTo.senderName, 'bob');
    assert.match(reply.replyTo.preview, /gg squad/);
  });

  // A member must not be able to read an admin-only channel at all.
  const secretRead = await api(`/api/communities/channels/${secretId}/messages`, { cookie: bob.cookie });
  check('admin-only channel history is refused to members', () =>
    assert.equal(secretRead.status, 403));

  const ownerRead = await api(`/api/communities/channels/${secretId}/messages`, { cookie: alice.cookie });
  check('the owner can read the admin-only channel', () => assert.equal(ownerRead.status, 200));

  const seededSecret = await Message.create({
    channelId: secretId,
    communityId,
    senderId: alice.id,
    text: 'zebracorn classified'
  });

  const crossChannelReply = await sendMessage(sockets.bob, {
    channelId: generalId,
    text: 'cross channel reply attempt',
    replyTo: { messageId: seededSecret._id }
  });
  check('reply to another channel is dropped', () =>
    assert.equal(crossChannelReply.replyTo ?? null, null));

  // ── Reactions ────────────────────────────────────────────────────────────
  console.log('\n[reactions]');
  const reactPath = `/api/communities/channels/${generalId}/messages/${mentionMessage._id}/react`;

  const carolReacts = await api(reactPath, { method: 'POST', cookie: carol.cookie, body: { emoji: 'fire' } });
  check('moderator reaction counted', () => {
    assert.equal(carolReacts.status, 200, JSON.stringify(carolReacts.data));
    assert.deepEqual(carolReacts.data.reactions, [{ emoji: 'fire', count: 1, mine: true }]);
  });

  const bobReacts = await api(reactPath, { method: 'POST', cookie: bob.cookie, body: { emoji: 'FIRE' } });
  check('reaction codes are case-insensitive and shared', () => {
    assert.equal(bobReacts.data.reactions[0].count, 2);
    assert.equal(bobReacts.data.reactions[0].mine, true);
  });

  const bobReactsAgain = await api(reactPath, { method: 'POST', cookie: bob.cookie, body: { emoji: 'fire' } });
  check('reacting again removes the reaction', () => {
    assert.equal(bobReactsAgain.data.reactions[0].count, 1);
    assert.equal(bobReactsAgain.data.reactions[0].mine, false);
  });

  const invalidReaction = await api(reactPath, { method: 'POST', cookie: bob.cookie, body: { emoji: '💩' } });
  check('unknown reaction codes are rejected', () => assert.equal(invalidReaction.status, 400));

  const eveReacts = await api(reactPath, { method: 'POST', cookie: eve.cookie, body: { emoji: 'fire' } });
  check('a non-member cannot react', () => assert.equal(eveReacts.status, 403));

  // A foreign message id is not reachable through another channel's URL.
  const wrongChannel = await api(
    `/api/communities/channels/${secretId}/messages/${mentionMessage._id}/react`,
    { method: 'POST', cookie: alice.cookie, body: { emoji: 'fire' } }
  );
  check('reaction route scopes the message to its channel', () =>
    assert.ok([403, 404].includes(wrongChannel.status), `got ${wrongChannel.status}`));

  const history = await api(`/api/communities/channels/${generalId}/messages`, { cookie: bob.cookie });
  check('history serialises reactions per viewer', () => {
    const row = history.data.messages.find((message) => message._id === mentionMessage._id);
    assert.ok(row, 'message missing from history');
    assert.equal(Array.isArray(row.reactions), true);
    assert.equal(row.reactions[0].count, 1);
    assert.equal(row.reactions[0].mine, false);
  });

  // ── Pinning ──────────────────────────────────────────────────────────────
  console.log('\n[pinning]');
  const pinPath = `/api/communities/channels/${generalId}/messages/${mentionMessage._id}/pin`;

  const bobPins = await api(pinPath, { method: 'POST', cookie: bob.cookie });
  check('a member cannot pin', () => assert.equal(bobPins.status, 403));

  const carolPins = await api(pinPath, { method: 'POST', cookie: carol.cookie });
  check('a moderator can pin', () => {
    assert.equal(carolPins.status, 200, JSON.stringify(carolPins.data));
    assert.equal(carolPins.data.pinned, true);
  });

  const pins = await api(`/api/communities/channels/${generalId}/pins`, { cookie: bob.cookie });
  check('members can read the pin tray', () => {
    assert.equal(pins.status, 200);
    assert.equal(pins.data.messages.length, 1);
  });

  const carolUnpins = await api(pinPath, { method: 'DELETE', cookie: carol.cookie });
  check('a moderator can unpin', () => assert.equal(carolUnpins.data.pinned, false));

  // Auditing is fire-and-forget by design, so poll instead of racing it.
  const auditPinned = await waitUntil(async () => !!(await AuditLog.exists({ communityId, actionType: 'MESSAGE_PIN' })));
  check('pinning is audited', () => assert.equal(auditPinned, true));

  // ── Search ───────────────────────────────────────────────────────────────
  console.log('\n[search]');
  const searchable = await sendMessage(sockets.bob, {
    channelId: generalId,
    text: 'zebracorn spotted in general'
  });
  check('searchable message stored', () => assert.ok(searchable._id));

  const bobSearch = await api(`/api/communities/${communityId}/search?q=zebracorn`, { cookie: bob.cookie });
  check('search returns only readable channels', () => {
    assert.equal(bobSearch.status, 200, JSON.stringify(bobSearch.data));
    assert.ok(bobSearch.data.messages.length >= 1);
    assert.equal(bobSearch.data.messages.every((hit) => hit.channelName !== 'secret'), true);
  });

  const secretScoped = await api(
    `/api/communities/${communityId}/search?q=zebracorn&channelId=${secretId}`,
    { cookie: bob.cookie }
  );
  check('search refuses a channel the caller cannot read', () => assert.equal(secretScoped.status, 403));

  const ownerSearch = await api(`/api/communities/${communityId}/search?q=zebracorn`, { cookie: alice.cookie });
  check('the owner does see the private channel hit', () => {
    assert.equal(ownerSearch.status, 200);
    assert.equal(ownerSearch.data.messages.some((hit) => hit.channelName === 'secret'), true);
  });

  const shortSearch = await api(`/api/communities/${communityId}/search?q=a`, { cookie: bob.cookie });
  check('search requires two characters', () => assert.equal(shortSearch.status, 400));

  // ── Forum channels ───────────────────────────────────────────────────────
  console.log('\n[forum]');
  const forumBase = `/api/communities/${communityId}/channels/${forumId}/forum`;

  const eveLists = await api(forumBase, { cookie: eve.cookie });
  check('a non-member cannot read a forum', () => assert.equal(eveLists.status, 403));

  const post = await api(forumBase, {
    method: 'POST',
    cookie: bob.cookie,
    body: { title: 'How do I counter a rush?', body: 'Stuck at gold, need advice.', tags: ['strategy'] }
  });
  check('a member can create a thread', () => assert.equal(post.status, 201, JSON.stringify(post.data)));
  const postId = post.data._id;

  const forumReply = await api(`${forumBase}/${postId}/replies`, {
    method: 'POST',
    cookie: dave.cookie,
    body: { body: 'Hold the choke point and wait for utility.' }
  });
  check('replies are accepted while open', () => assert.equal(forumReply.status, 201, JSON.stringify(forumReply.data)));

  const thread = await api(`${forumBase}/${postId}`, { cookie: bob.cookie });
  check('thread shows the reply and count', () => {
    assert.equal(thread.data.replies.length, 1);
    assert.equal(thread.data.post.replyCount, 1);
  });

  const daveLocks = await api(`${forumBase}/${postId}/status`, {
    method: 'PATCH',
    cookie: dave.cookie,
    body: { status: 'locked' }
  });
  check('a member cannot lock a thread', () => assert.equal(daveLocks.status, 403));

  const carolLocks = await api(`${forumBase}/${postId}/status`, {
    method: 'PATCH',
    cookie: carol.cookie,
    body: { status: 'locked' }
  });
  check('a moderator can lock a thread', () => assert.equal(carolLocks.data.status, 'locked'));

  const lockedReply = await api(`${forumBase}/${postId}/replies`, {
    method: 'POST',
    cookie: dave.cookie,
    body: { body: 'still talking' }
  });
  check('a locked thread rejects replies', () => assert.equal(lockedReply.status, 403));

  const forumSocketJoined = await joinChannel(sockets.bob, forumId);
  check('forum channels are readable over the socket', () => assert.ok(forumSocketJoined.channelId));
  await expectSendError(sockets.bob, { channelId: forumId, text: 'live message in a forum' }, 'FORUM_CHANNEL');

  // join_channel leaves the previous room, so go back to the text channel.
  await joinChannel(sockets.bob, generalId);

  const deletedPost = await api(`${forumBase}/${postId}`, { method: 'DELETE', cookie: carol.cookie });
  check('a moderator can delete a thread', () => assert.equal(deletedPost.status, 200));

  const afterDelete = await api(forumBase, { cookie: bob.cookie });
  check('deleted threads leave the list', () => assert.equal(afterDelete.data.posts.length, 0));

  // ── Attachments ──────────────────────────────────────────────────────────
  console.log('\n[attachments]');
  const noFile = await api(`/api/communities/channels/${generalId}/attachments`, {
    method: 'POST',
    cookie: bob.cookie,
    body: {}
  });
  check('upload without a file is rejected', () => assert.equal(noFile.status, 400));

  const bobUpload = await Attachment.create({
    channelId: generalId,
    communityId,
    uploaderId: bob.id,
    cloudinaryId: 'gaming-hub/chat/e2e-bob',
    url: 'https://res.cloudinary.com/demo/image/upload/e2e-bob.png',
    mimeType: 'image/png',
    sizeBytes: 2048,
    status: 'ready'
  });
  const aliceUpload = await Attachment.create({
    channelId: generalId,
    communityId,
    uploaderId: alice.id,
    cloudinaryId: 'gaming-hub/chat/e2e-alice',
    url: 'https://res.cloudinary.com/demo/image/upload/e2e-alice.png',
    mimeType: 'image/png',
    sizeBytes: 2048,
    status: 'ready'
  });

  const withAttachment = await sendMessage(sockets.bob, {
    channelId: generalId,
    text: 'look at this',
    attachmentIds: [String(bobUpload._id)]
  });
  check('an uploaded attachment can be attached', () => {
    assert.equal(withAttachment.attachments.length, 1);
    assert.equal(withAttachment.attachments[0].mimeType, 'image/png');
  });

  const linked = await Attachment.findById(bobUpload._id).lean();
  check('the attachment is claimed by the message', () =>
    assert.equal(String(linked.messageId), String(withAttachment._id)));

  const stolen = await sendMessage(sockets.bob, {
    channelId: generalId,
    text: 'trying to attach someone else',
    attachmentIds: [String(aliceUpload._id)]
  });
  check("another user's attachment is dropped", () => assert.equal(stolen.attachments.length, 0));

  const eveAttachment = await api(
    `/api/communities/channels/${generalId}/attachments/${bobUpload._id}`,
    { cookie: eve.cookie }
  );
  check('a non-member cannot fetch an attachment URL', () => assert.equal(eveAttachment.status, 403));

  // ── Timeouts ─────────────────────────────────────────────────────────────
  console.log('\n[timeouts]');
  const daveTimesOutBob = await api(`/api/communities/${communityId}/members/${bob.id}/timeout`, {
    method: 'POST',
    cookie: dave.cookie,
    body: { durationMinutes: 5 }
  });
  check('a member cannot time out a peer', () => assert.equal(daveTimesOutBob.status, 403));

  const invalidDuration = await api(`/api/communities/${communityId}/members/${bob.id}/timeout`, {
    method: 'POST',
    cookie: carol.cookie,
    body: { durationMinutes: 3 }
  });
  check('only allowlisted timeout durations are accepted', () => assert.equal(invalidDuration.status, 400));

  const timedOut = await api(`/api/communities/${communityId}/members/${bob.id}/timeout`, {
    method: 'POST',
    cookie: carol.cookie,
    body: { durationMinutes: 5 }
  });
  check('a moderator can time out a member', () => assert.equal(timedOut.status, 200, JSON.stringify(timedOut.data)));

  await expectSendError(sockets.bob, { channelId: generalId, text: 'am I muted?' }, 'TIMEOUT');

  const lift = await api(`/api/communities/${communityId}/members/${bob.id}/timeout`, {
    method: 'DELETE',
    cookie: carol.cookie
  });
  check('a timeout can be lifted', () => assert.equal(lift.status, 200));

  const afterLift = await sendMessage(sockets.bob, { channelId: generalId, text: 'back in action' });
  check('sending works again after the timeout', () => assert.ok(afterLift._id));

  // ── Bans ─────────────────────────────────────────────────────────────────
  console.log('\n[bans]');
  const revoked = waitFor(sockets.dave, 'membership_revoked');
  const banned = await api(`/api/communities/${communityId}/bans/${dave.id}`, {
    method: 'POST',
    cookie: alice.cookie,
    body: { reason: 'e2e' }
  });
  check('the owner can ban a member', () => assert.equal(banned.status, 200, JSON.stringify(banned.data)));

  const revokePayload = await revoked;
  check('the banned member is evicted from live rooms', () =>
    assert.equal(String(revokePayload?.communityId), String(communityId)));

  const rejoin = await api(`/api/communities/${communityId}/join`, { method: 'POST', cookie: dave.cookie });
  check('a banned user cannot rejoin', () => assert.equal(rejoin.status, 403));

  const moderatorBans = await api(`/api/communities/${communityId}/bans/${bob.id}`, {
    method: 'POST',
    cookie: carol.cookie
  });
  check('a moderator cannot ban (admin capability required)', () =>
    assert.equal(moderatorBans.status, 403));

  const banList = await api(`/api/communities/${communityId}/bans`, { cookie: alice.cookie });
  check('the ban list shows the banned user', () => {
    assert.equal(banList.status, 200);
    assert.equal(banList.data.bans.some((entry) => entry.userId === dave.id), true);
  });

  const unbanned = await api(`/api/communities/${communityId}/bans/${dave.id}`, {
    method: 'DELETE',
    cookie: alice.cookie
  });
  check('the owner can lift a ban', () => assert.equal(unbanned.status, 200));

  const rejoinAfterUnban = await api(`/api/communities/${communityId}/join`, {
    method: 'POST',
    cookie: dave.cookie
  });
  check('an unbanned user can rejoin', () => assert.equal(rejoinAfterUnban.status, 200));

  // ── Reports ──────────────────────────────────────────────────────────────
  console.log('\n[reports]');
  const reportBody = {
    targetType: 'message',
    targetId: mentionMessage._id,
    reason: 'spam',
    note: 'e2e report'
  };

  const reported = await api(`/api/communities/${communityId}/reports`, {
    method: 'POST',
    cookie: bob.cookie,
    body: reportBody
  });
  check('a member can report a message', () => assert.equal(reported.status, 201, JSON.stringify(reported.data)));

  const duplicate = await api(`/api/communities/${communityId}/reports`, {
    method: 'POST',
    cookie: bob.cookie,
    body: reportBody
  });
  check('a duplicate report is a silent no-op', () => assert.equal(duplicate.status, 201));

  const outsiderReport = await api(`/api/communities/${communityId}/reports`, {
    method: 'POST',
    cookie: eve.cookie,
    body: reportBody
  });
  check('a non-member cannot report', () => assert.equal(outsiderReport.status, 403));

  const memberQueue = await api(`/api/communities/${communityId}/reports`, { cookie: bob.cookie });
  check('a member cannot read the report queue', () => assert.equal(memberQueue.status, 403));

  const modQueue = await api(`/api/communities/${communityId}/reports`, { cookie: carol.cookie });
  check('a moderator sees exactly one report', () => {
    assert.equal(modQueue.status, 200, JSON.stringify(modQueue.data));
    assert.equal(modQueue.data.reports.length, 1);
    assert.equal(modQueue.data.reports[0].targetPreview.text.includes('gg squad'), true);
    assert.equal(modQueue.data.reports[0].reporter.username, 'bob');
  });

  const reviewed = await api(
    `/api/communities/${communityId}/reports/${modQueue.data.reports[0]._id}`,
    { method: 'PATCH', cookie: carol.cookie, body: { status: 'dismissed' } }
  );
  check('a moderator can resolve a report', () => assert.equal(reviewed.data.status, 'dismissed'));

  const auditedReport = await waitUntil(async () =>
    !!(await AuditLog.exists({ communityId, actionType: 'REPORT_REVIEWED' }))
  );
  check('report resolution is audited', () => assert.equal(auditedReport, true));

  // ── Personal mutes ───────────────────────────────────────────────────────
  console.log('\n[mutes]');
  const muted = await api(`/api/users/${dave.id}/mute`, { method: 'POST', cookie: bob.cookie });
  check('a user can mute another user', () => {
    assert.equal(muted.status, 200, JSON.stringify(muted.data));
    assert.equal(muted.data.muted, true);
  });

  const mutedList = await api('/api/users/me/muted', { cookie: bob.cookie });
  check('the mute list is per user', () => assert.deepEqual(mutedList.data.mutedUsers, [dave.id]));

  const selfMute = await api(`/api/users/${bob.id}/mute`, { method: 'POST', cookie: bob.cookie });
  check('a user cannot mute themselves', () => assert.equal(selfMute.status, 400));

  const unmuted = await api(`/api/users/${dave.id}/mute`, { method: 'POST', cookie: bob.cookie });
  check('a mute toggles off', () => assert.equal(unmuted.data.muted, false));

  // ── Community settings surface ───────────────────────────────────────────
  console.log('\n[channel settings]');
  const forumConfigSaved = await api(`/api/communities/${communityId}/channels/${forumId}`, {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { forumConfig: { allowedTags: ['Strategy', 'bugs'], requireTag: true }, attachmentsEnabled: false }
  });
  check('forum config is stored and normalised', () => {
    assert.equal(forumConfigSaved.status, 200, JSON.stringify(forumConfigSaved.data));
    assert.deepEqual(forumConfigSaved.data.forumConfig.allowedTags, ['strategy', 'bugs']);
    assert.equal(forumConfigSaved.data.forumConfig.requireTag, true);
    assert.equal(forumConfigSaved.data.attachmentsEnabled, false);
  });

  const untagged = await api(`/api/communities/${communityId}/channels/${forumId}/forum`, {
    method: 'POST',
    cookie: bob.cookie,
    body: { title: 'No tags here', body: 'should fail' }
  });
  check('a forum can require a tag', () => assert.equal(untagged.status, 400));

  const communityReload = await api(`/api/communities/${slug}`, { cookie: alice.cookie });
  check('the forum channel is visible in the sidebar payload', () => {
    const channel = communityReload.data.channels.find((row) => row._id === forumId);
    assert.ok(channel);
    assert.equal(channel.type, 'forum');
  });

  // ── Audit trail ──────────────────────────────────────────────────────────
  console.log('\n[audit]');
  for (const action of ['MEMBER_TIMEOUT', 'MEMBER_TIMEOUT_LIFT', 'MEMBER_BAN', 'MEMBER_UNBAN', 'MESSAGE_PIN', 'REPORT_REVIEWED']) {
    const present = await waitUntil(async () => !!(await AuditLog.exists({ communityId, actionType: action })));
    check(`audit records ${action}`, () => assert.equal(present, true));
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
