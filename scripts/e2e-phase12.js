/**
 * Phase 12 end-to-end verification — creator-scale messaging.
 *
 * Runs against a THROWAWAY database on the same cluster:
 *   node scripts/e2e-phase12.js
 *
 * Proves the parts that are not pure policy: hidden-word filtering, the
 * Filtered lane, private labels, pause/away behavior, campaign detection,
 * reputation filtering and the audited admin report queue.
 */
require('dotenv').config();
const http = require('http');
const assert = require('assert/strict');
const mongoose = require('mongoose');

const E2E_DB = `gamerhub_e2e12_${Date.now().toString(36)}`;

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
const { closeDomainConnections } = require('../server/config/connections');

const User = require('../server/models/User');
const DmReport = require('../server/models/DmReport');
const DmSenderReputation = require('../server/models/DmSenderReputation');
const DmModerationAudit = require('../server/models/DmModerationAudit');

const { api, check, report, setBase, registerUser } = require('./lib/e2e-harness');

async function scenarios({ alice, bob, dave, gina, henry, iris, jack, admin }) {
  // The campaign and quota probes need an established sender; recipients are
  // intentionally fresh accounts.
  const established = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  // timestamps.immutable blocks a Mongoose update of createdAt; the raw
  // collection is the fixture-only way to age these accounts past the new-user
  // one-per-day quota.
  await User.collection.updateMany(
    { _id: { $in: [bob.id, dave.id].map((id) => new mongoose.Types.ObjectId(id)) } },
    { $set: { createdAt: established } }
  );
  await User.updateOne({ _id: admin.id }, { $set: { role: 'admin' } });

  const settings = await api('/api/account/dm-settings', {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { hiddenWords: ['crypto'] }
  });
  check('a creator can add hidden words', () => {
    assert.equal(settings.status, 200, JSON.stringify(settings.data));
    assert.deepEqual(settings.data.dmSettings.hiddenWords, ['crypto']);
  });

  const hiddenRequest = await api('/api/messages/requests', {
    method: 'POST',
    cookie: bob.cookie,
    body: { recipientId: alice.id, text: 'Want to buy crypto with me?' }
  });
  check('a hidden-word request is accepted but filtered silently', () => {
    assert.equal(hiddenRequest.status, 201, JSON.stringify(hiddenRequest.data));
    assert.equal(hiddenRequest.data.direct, false);
    assert.equal(hiddenRequest.data.conversation.state, 'request');
    // The sender must not learn that their request was filtered.
    assert.equal(hiddenRequest.data.conversation.filtered, false);
  });
  const hiddenId = String(hiddenRequest.data.conversation._id);

  const summary = await api('/api/messages/summary', { cookie: alice.cookie });
  check('a filtered request stays out of the Requests count', () => {
    assert.equal(summary.status, 200, JSON.stringify(summary.data));
    assert.equal(summary.data.requests, 0);
    assert.equal(summary.data.filtered, 1);
  });

  const requestLane = await api('/api/messages/conversations?folder=requests', { cookie: alice.cookie });
  const filteredLane = await api('/api/messages/conversations?folder=filtered', { cookie: alice.cookie });
  check('the filtered request appears only in the Filtered lane', () => {
    assert.equal(requestLane.status, 200, JSON.stringify(requestLane.data));
    assert.equal(filteredLane.status, 200, JSON.stringify(filteredLane.data));
    assert.equal(requestLane.data.items.some((item) => item._id === hiddenId), false);
    assert.equal(filteredLane.data.items.some((item) => item._id === hiddenId), true);
  });

  const aliceView = await api(`/api/messages/conversations/${hiddenId}`, { cookie: alice.cookie });
  check('the recipient sees why the request was filtered', () => {
    assert.equal(aliceView.status, 200, JSON.stringify(aliceView.data));
    assert.equal(aliceView.data.conversation.filtered, true);
    assert.equal(aliceView.data.conversation.filterReason, 'hidden_word');
    assert.equal(aliceView.data.conversation.filterMatched, 'crypto');
  });

  const labels = await api(`/api/messages/conversations/${hiddenId}/labels`, {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { labels: ['VIP', 'Collab', 'vip'] }
  });
  check('a creator can add private labels', () => {
    assert.equal(labels.status, 200, JSON.stringify(labels.data));
    assert.deepEqual(labels.data.labels, ['VIP', 'Collab']);
    assert.deepEqual(labels.data.conversation.labels, ['VIP', 'Collab']);
  });

  const bobView = await api(`/api/messages/conversations/${hiddenId}`, { cookie: bob.cookie });
  check('labels are never visible to the other participant', () => {
    assert.equal(bobView.status, 200, JSON.stringify(bobView.data));
    assert.deepEqual(bobView.data.conversation.labels, []);
  });

  const accepted = await api(`/api/messages/conversations/${hiddenId}/accept`, {
    method: 'POST',
    cookie: alice.cookie
  });
  check('a filtered request can still be accepted', () => {
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
    assert.equal(accepted.data.conversation.state, 'active');
  });

  const activeReply = await api(`/api/messages/conversations/${hiddenId}/messages`, {
    method: 'POST',
    cookie: bob.cookie,
    body: { text: 'Thanks for accepting.' }
  });
  check('accepting a filtered request opens the thread', () => {
    assert.equal(activeReply.status, 201, JSON.stringify(activeReply.data));
  });

  const creatorTools = await api('/api/account/dm-settings', {
    method: 'PATCH',
    cookie: alice.cookie,
    body: {
      availability: 'away',
      awayMessage: 'Back after the weekend',
      quickReplies: ['Thanks, I will take a look.', 'Not this month.']
    }
  });
  check('a creator can set away mode and quick replies', () => {
    assert.equal(creatorTools.status, 200, JSON.stringify(creatorTools.data));
    assert.equal(creatorTools.data.dmSettings.availability, 'away');
    assert.equal(creatorTools.data.dmSettings.awayMessage, 'Back after the weekend');
    assert.deepEqual(creatorTools.data.dmSettings.quickReplies, [
      'Thanks, I will take a look.',
      'Not this month.'
    ]);
  });

  const quickSummary = await api('/api/messages/summary', { cookie: alice.cookie });
  check('the inbox summary returns only the owner quick replies', () => {
    assert.equal(quickSummary.status, 200, JSON.stringify(quickSummary.data));
    assert.equal(quickSummary.data.quickReplies.length, 2);
  });

  const awayProfile = await api('/api/users/dm12alice', { cookie: bob.cookie });
  check('away mode is disclosed on the profile without exposing settings', () => {
    assert.equal(awayProfile.status, 200, JSON.stringify(awayProfile.data));
    assert.equal(awayProfile.data.dm.availability, 'away');
    assert.equal(awayProfile.data.dm.awayMessage, 'Back after the weekend');
    assert.equal(awayProfile.data.dmSettings, undefined);
  });

  const paused = await api('/api/account/dm-settings', {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { availability: 'paused' }
  });
  check('a creator can pause the inbox', () => {
    assert.equal(paused.status, 200, JSON.stringify(paused.data));
    assert.equal(paused.data.dmSettings.availability, 'paused');
  });

  const pausedProfile = await api('/api/users/dm12alice', { cookie: dave.cookie });
  check('a paused inbox reports why it is closed', () => {
    assert.equal(pausedProfile.status, 200, JSON.stringify(pausedProfile.data));
    assert.equal(pausedProfile.data.dm.mode, 'paused');
    assert.equal(pausedProfile.data.dm.allowed, false);
  });

  const duringPause = await api('/api/messages/requests', {
    method: 'POST',
    cookie: dave.cookie,
    body: { recipientId: alice.id, text: 'Are you around?' }
  });
  check('a paused inbox refuses a new request', () => {
    assert.equal(duringPause.status, 403, JSON.stringify(duringPause.data));
    assert.match(String(duringPause.data?.message || ''), /paused/i);
  });

  const existingThread = await api(`/api/messages/conversations/${hiddenId}/messages`, {
    method: 'POST',
    cookie: bob.cookie,
    body: { text: 'The existing thread still works.' }
  });
  check('pausing does not interrupt an accepted conversation', () => {
    assert.equal(existingThread.status, 201, JSON.stringify(existingThread.data));
  });

  await api('/api/account/dm-settings', {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { availability: 'away', awayMessage: 'Back after the weekend' }
  });
  const awayReply = await api(`/api/messages/conversations/${hiddenId}/messages`, {
    method: 'POST',
    cookie: bob.cookie,
    body: { text: 'One more note before you go.' }
  });
  check('an away thread sends one auto-reply', () => {
    assert.equal(awayReply.status, 201, JSON.stringify(awayReply.data));
    assert.equal(awayReply.data.autoReply?.text, 'Back after the weekend');
  });

  const secondAwayReply = await api(`/api/messages/conversations/${hiddenId}/messages`, {
    method: 'POST',
    cookie: bob.cookie,
    body: { text: 'And one more.' }
  });
  check('the away auto-reply is limited to once per day', () => {
    assert.equal(secondAwayReply.status, 201, JSON.stringify(secondAwayReply.data));
    assert.equal(secondAwayReply.data.autoReply, undefined);
  });

  await api('/api/account/dm-settings', {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { availability: 'open' }
  });

  const campaignText = 'Same campaign opener for every creator.';
  for (const recipient of [gina, henry, iris]) {
    const sent = await api('/api/messages/requests', {
      method: 'POST',
      cookie: bob.cookie,
      body: { recipientId: recipient.id, text: campaignText }
    });
    check(`campaign request to ${recipient.username} is created`, () => {
      assert.equal(sent.status, 201, JSON.stringify(sent.data));
    });
  }

  const irisSummary = await api('/api/messages/summary', { cookie: iris.cookie });
  const irisLane = await api('/api/messages/conversations?folder=filtered', { cookie: iris.cookie });
  check('identical outreach is detected on the third recipient', () => {
    assert.equal(irisSummary.status, 200, JSON.stringify(irisSummary.data));
    assert.equal(irisSummary.data.requests, 0);
    assert.equal(irisSummary.data.filtered, 1);
    assert.equal(irisLane.data.items.length, 1);
    assert.equal(irisLane.data.items[0].filterReason, 'campaign');
  });

  const ginaReport = await api(`/api/messages/conversations/${(await api('/api/messages/conversations?folder=requests', { cookie: gina.cookie })).data.items[0]._id}/report`, {
    method: 'POST',
    cookie: gina.cookie,
    body: { reason: 'spam', note: 'Repeated cold outreach', block: false }
  });
  check('a recipient can report a pending request', () => {
    assert.equal(ginaReport.status, 201, JSON.stringify(ginaReport.data));
    assert.equal(ginaReport.data.reported, true);
    assert.equal(ginaReport.data.blocked, false);
  });

  const reputation = await DmSenderReputation.findOne({ userId: bob.id }).lean();
  check('a report moves the sender into the limited reputation tier', () => {
    assert.ok(reputation, 'missing reputation row');
    assert.equal(reputation.reports, 1);
    assert.equal(reputation.tier, 'limited');
  });

  await DmSenderReputation.updateOne({ userId: bob.id }, { $set: { tier: 'restricted' } });
  const restrictedRequest = await api('/api/messages/requests', {
    method: 'POST',
    cookie: bob.cookie,
    body: { recipientId: jack.id, text: 'A different pitch for a new creator.' }
  });
  const jackSummary = await api('/api/messages/summary', { cookie: jack.cookie });
  check('a restricted sender lands in Filtered without being told', () => {
    assert.equal(restrictedRequest.status, 201, JSON.stringify(restrictedRequest.data));
    assert.equal(restrictedRequest.data.conversation.filtered, false);
    assert.equal(jackSummary.data.requests, 0);
    assert.equal(jackSummary.data.filtered, 1);
  });

  const adminQueue = await api('/api/admin/dm-reports?status=open', { cookie: admin.cookie });
  check('an admin can read the DM report queue', () => {
    assert.equal(adminQueue.status, 200, JSON.stringify(adminQueue.data));
    assert.equal(adminQueue.data.items.length, 1);
    assert.equal(adminQueue.data.items[0].reason, 'spam');
    assert.equal(adminQueue.data.items[0].reporter.username, 'dm12gina');
    assert.equal(adminQueue.data.items[0].reported.username, 'dm12bob');
  });

  const reportId = adminQueue.data.items[0]._id;
  const resolved = await api(`/api/admin/dm-reports/${reportId}/resolve`, {
    method: 'POST',
    cookie: admin.cookie,
    body: { status: 'dismissed', note: 'No action needed for the probe.' }
  });
  check('an admin can resolve a report with an audit note', () => {
    assert.equal(resolved.status, 200, JSON.stringify(resolved.data));
    assert.equal(resolved.data.report.status, 'dismissed');
    assert.equal(resolved.data.report.reviewNote, 'No action needed for the probe.');
  });

  const auditRows = await DmModerationAudit.countDocuments({ reportId });
  check('resolution writes a platform audit row', () => assert.equal(auditRows, 1));

  const openAfter = await api('/api/admin/dm-reports?status=open', { cookie: admin.cookie });
  check('the resolved report leaves the open queue', () => {
    assert.equal(openAfter.status, 200, JSON.stringify(openAfter.data));
    assert.equal(openAfter.data.items.length, 0);
  });

  const reportCount = await DmReport.countDocuments({ status: 'open' });
  check('the report remains stored after resolution', () => assert.equal(reportCount, 0));
}

async function run() {
  await connectDB();
  console.log(`Using throwaway database: ${E2E_DB}`);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  setBase(`http://127.0.0.1:${server.address().port}`);

  const alice = await registerUser('dm12alice', { probeId: true });
  const bob = await registerUser('dm12bob', { probeId: true });
  const dave = await registerUser('dm12dave', { probeId: true });
  const gina = await registerUser('dm12gina', { probeId: true });
  const henry = await registerUser('dm12henry', { probeId: true });
  const iris = await registerUser('dm12iris', { probeId: true });
  const jack = await registerUser('dm12jack', { probeId: true });
  const admin = await registerUser('dm12admin', { probeId: true });

  try {
    await scenarios({ alice, bob, dave, gina, henry, iris, jack, admin });
  } finally {
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
