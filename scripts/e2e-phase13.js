/**
 * Phase 13 end-to-end verification — business accounts and structured outreach.
 *
 * Runs against a THROWAWAY database on the same cluster:
 *   node scripts/e2e-phase13.js
 */
require('dotenv').config();
const http = require('http');
const assert = require('assert/strict');
const mongoose = require('mongoose');

const E2E_DB = `gamerhub_e2e13_${Date.now().toString(36)}`;

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
const BusinessProfile = require('../server/models/BusinessProfile');
const BusinessVerificationAudit = require('../server/models/BusinessVerificationAudit');
const Conversation = require('../server/models/Conversation');

const { api, check, report, setBase, registerUser } = require('./lib/e2e-harness');

const BUSINESS_BODY = {
  displayName: 'Sofia Studio',
  category: 'studio',
  description: 'A small independent game studio.',
  website: 'https://sofia.example',
  supportEmail: 'hello@sofia.example',
  timezone: 'Europe/London',
  responseExpectation: 'Replies within 3 working days'
};

async function scenarios({ sofia, alex, dana, mark, nina, rita, manual, admin, tom }) {
  await User.updateOne({ _id: admin.id }, { $set: { role: 'admin' } });
  // The report-pause probe sends several briefs. Age the sender past the
  // one-per-day new-account quota; timestamps are immutable in Mongoose, so the
  // fixture writes the raw collection.
  await User.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(sofia.id) },
    { $set: { createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }
  );

  const saved = await api('/api/account/business-profile', {
    method: 'POST',
    cookie: sofia.cookie,
    body: BUSINESS_BODY
  });
  check('an account can become a disclosed business', () => {
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.profileType, 'creator_business');
    assert.equal(saved.data.businessProfile.verificationStatus, 'none');
    assert.equal(saved.data.businessProfile.displayName, 'Sofia Studio');
  });

  const account = await api('/api/account', { cookie: sofia.cookie });
  check('the owner account exposes its business profile', () => {
    assert.equal(account.status, 200, JSON.stringify(account.data));
    assert.equal(account.data.profileType, 'creator_business');
    assert.equal(account.data.businessProfile.website, 'https://sofia.example');
  });

  const profile = await api('/api/users/biz13sofia', { cookie: alex.cookie });
  check('the public profile carries the Business label and card', () => {
    assert.equal(profile.status, 200, JSON.stringify(profile.data));
    assert.equal(profile.data.profileType, 'creator_business');
    assert.equal(profile.data.business.displayName, 'Sofia Studio');
    assert.equal(profile.data.business.verificationStatus, 'none');
  });

  const unverified = await api('/api/messages/requests', {
    method: 'POST',
    cookie: sofia.cookie,
    body: {
      recipientId: alex.id,
      text: 'We would love to work with you on a small sponsorship.',
      intent: 'sponsorship',
      company: 'Sofia Studio',
      website: 'https://sofia.example',
      budgetBand: '500_2000',
      timeline: 'Next month'
    }
  });
  check('an unverified business cannot cold-contact anyone', () => {
    assert.equal(unverified.status, 403, JSON.stringify(unverified.data));
    assert.match(String(unverified.data?.message || ''), /verify/i);
  });

  const verification = await api('/api/account/business-verification', {
    method: 'POST',
    cookie: sofia.cookie,
    body: { method: 'dns' }
  });
  check('a business can request DNS verification', () => {
    assert.equal(verification.status, 200, JSON.stringify(verification.data));
    assert.equal(verification.data.businessProfile.verificationStatus, 'pending');
    assert.equal(verification.data.instructions.recordType, 'TXT');
    assert.match(verification.data.instructions.recordValue, /^gamerhub-verify=/);
  });

  const pending = await api('/api/admin/business-verifications?status=pending', {
    cookie: admin.cookie
  });
  const pendingItem = pending.data?.items?.find((item) => item.user?.username === 'biz13sofia');
  check('an admin can see the pending business request', () => {
    assert.equal(pending.status, 200, JSON.stringify(pending.data));
    assert.ok(pendingItem, 'missing pending business');
    assert.equal(pendingItem.business.displayName, 'Sofia Studio');
    assert.match(pendingItem.token, /^[a-f0-9]{32}$/);
  });

  const approved = await api(`/api/admin/business-verifications/${pendingItem._id}/resolve`, {
    method: 'POST',
    cookie: admin.cookie,
    body: { status: 'verified', note: 'DNS record checked in the review console.' }
  });
  check('an admin can verify a business with an audit decision', () => {
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    assert.equal(approved.data.status, 'verified');
  });

  const auditRows = await BusinessVerificationAudit.countDocuments({
    businessProfileId: pendingItem._id
  });
  check('verification writes an audit row', () => assert.equal(auditRows, 1));

  const verifiedProfile = await api('/api/business/biz13sofia');
  check('the public business endpoint exposes the verified card', () => {
    assert.equal(verifiedProfile.status, 200, JSON.stringify(verifiedProfile.data));
    assert.equal(verifiedProfile.data.business.verificationStatus, 'verified');
    assert.equal(verifiedProfile.data.profileType, 'creator_business');
  });

  const mismatch = await api('/api/messages/requests', {
    method: 'POST',
    cookie: sofia.cookie,
    body: {
      recipientId: dana.id,
      text: 'A brief with the wrong domain.',
      intent: 'collab',
      company: 'Sofia Studio',
      website: 'https://not-sofia.example'
    }
  });
  check('a brief website must match the verified domain', () => {
    assert.equal(mismatch.status, 400, JSON.stringify(mismatch.data));
    assert.match(String(mismatch.data?.message || ''), /match/i);
  });

  const brief = await api('/api/messages/requests', {
    method: 'POST',
    cookie: sofia.cookie,
    body: {
      recipientId: alex.id,
      text: 'We would love to work with you on a small sponsorship.',
      intent: 'sponsorship',
      company: 'Sofia Studio',
      website: 'https://sofia.example',
      budgetBand: '500_2000',
      timeline: 'Next month'
    }
  });
  check('a verified business can send a structured brief', () => {
    assert.equal(brief.status, 201, JSON.stringify(brief.data));
    assert.equal(brief.data.direct, false);
    assert.equal(brief.data.conversation.request.business.intent, 'sponsorship');
    assert.equal(brief.data.conversation.request.business.budgetBand, '500_2000');
    assert.equal(brief.data.conversation.filtered, false);
  });

  const alexThread = await api(`/api/messages/conversations/${brief.data.conversation._id}`, {
    cookie: alex.cookie
  });
  check('the recipient sees the business brief and disclosed counterpart', () => {
    assert.equal(alexThread.status, 200, JSON.stringify(alexThread.data));
    assert.equal(alexThread.data.conversation.counterpart.profileType, 'creator_business');
    assert.equal(alexThread.data.conversation.request.business.company, 'Sofia Studio');
    assert.equal(alexThread.data.conversation.request.business.timeline, 'Next month');
  });

  const businessLane = await api('/api/messages/conversations?folder=requests&scope=business', {
    cookie: alex.cookie
  });
  check('the recipient can scope requests to business', () => {
    assert.equal(businessLane.status, 200, JSON.stringify(businessLane.data));
    assert.ok(businessLane.data.items.length >= 1);
    assert.ok(businessLane.data.items.every((item) => item.businessThread));
  });

  const personalLane = await api('/api/messages/conversations?folder=requests&scope=personal', {
    cookie: alex.cookie
  });
  check('the personal lane excludes business requests', () => {
    assert.equal(personalLane.status, 200, JSON.stringify(personalLane.data));
    assert.equal(personalLane.data.items.length, 0);
  });

  const savedView = await api('/api/account/dm-settings', {
    method: 'PATCH',
    cookie: alex.cookie,
    body: {
      savedFilters: [{ name: 'Business requests', folder: 'requests', scope: 'business', unreadOnly: false }]
    }
  });
  check('a recipient can save a business-request view', () => {
    assert.equal(savedView.status, 200, JSON.stringify(savedView.data));
    assert.equal(savedView.data.dmSettings.savedFilters[0].name, 'Business requests');
  });

  const savedLane = await api('/api/messages/conversations?folder=requests&scope=business', {
    cookie: alex.cookie
  });
  check('the saved view is returned with the inbox', () => {
    assert.equal(savedLane.status, 200, JSON.stringify(savedLane.data));
    assert.equal(savedLane.data.savedFilters[0].scope, 'business');
  });

  const policy = await api('/api/account/dm-settings', {
    method: 'PATCH',
    cookie: dana.cookie,
    body: { policy: { business: 'none' } }
  });
  check('a recipient can close the business row separately', () => {
    assert.equal(policy.status, 200, JSON.stringify(policy.data));
    assert.equal(policy.data.dmSettings.policy.business, 'none');
  });

  const blockedByPolicy = await api('/api/messages/requests', {
    method: 'POST',
    cookie: sofia.cookie,
    body: {
      recipientId: dana.id,
      text: 'A legitimate brief that should still respect policy.',
      intent: 'collab',
      company: 'Sofia Studio'
    }
  });
  check('the business row blocks verified outreach when set to nobody', () => {
    assert.equal(blockedByPolicy.status, 403, JSON.stringify(blockedByPolicy.data));
    assert.equal(blockedByPolicy.data?.code, 'DM_POLICY_NONE');
  });

  await api('/api/account/dm-settings', {
    method: 'PATCH',
    cookie: dana.cookie,
    body: { policy: { business: 'request' } }
  });

  const analytics = await api('/api/account/business/analytics', { cookie: sofia.cookie });
  check('the owner can read business outreach counters', () => {
    assert.equal(analytics.status, 200, JSON.stringify(analytics.data));
    assert.equal(analytics.data.sent, 1);
    assert.equal(analytics.data.accepted, 0);
  });

  const personalFixture = await Conversation.create({
    pairKey: Conversation.pairKeyFor(sofia.id, admin.id),
    participantIds: [sofia.id, admin.id],
    initiatorId: admin.id,
    recipientId: sofia.id,
    state: 'active',
    acceptedAt: new Date(),
    businessThread: false,
    unreadCounts: { [String(sofia.id)]: 0, [String(admin.id)]: 0 }
  });

  // An inbound request is the owner's to accept. The outbound brief above is
  // Sent, not Requests, so it must not be used to probe the team request lane.
  const inboundRequest = await Conversation.create({
    pairKey: Conversation.pairKeyFor(sofia.id, manual.id),
    participantIds: [sofia.id, manual.id],
    initiatorId: manual.id,
    recipientId: sofia.id,
    state: 'request',
    businessThread: true,
    requestText: 'An inbound business enquiry for the shared inbox.',
    requestIntent: 'collab',
    requestCompany: 'Manual Review Studio',
    requestExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    lastRequestAt: new Date(),
    unreadCounts: { [String(sofia.id)]: 0, [String(manual.id)]: 0 }
  });

  const invitation = await api('/api/account/business/team', {
    method: 'POST',
    cookie: sofia.cookie,
    body: { username: 'biz13tom', role: 'viewer' }
  });
  check('a business can invite a teammate by handle', () => {
    assert.equal(invitation.status, 201, JSON.stringify(invitation.data));
    assert.equal(invitation.data.item.username, 'biz13tom');
    assert.equal(invitation.data.item.status, 'invited');
  });

  const pendingTeam = await api('/api/messages/team', { cookie: tom.cookie });
  check('an invitation appears before any thread is shared', () => {
    assert.equal(pendingTeam.status, 200, JSON.stringify(pendingTeam.data));
    assert.equal(pendingTeam.data.teams.length, 0);
    assert.equal(pendingTeam.data.invites[0].ownerId, sofia.id);
    assert.equal(pendingTeam.data.invites[0].role, 'viewer');
  });

  const accepted = await api(`/api/messages/team/${sofia.id}/respond`, {
    method: 'POST',
    cookie: tom.cookie,
    body: { accept: true }
  });
  check('the invitee must accept before joining', () => {
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
    assert.equal(accepted.data.accepted, true);
  });

  const workspaces = await api('/api/messages/team', { cookie: tom.cookie });
  check('an accepted workspace exposes the viewer role', () => {
    assert.equal(workspaces.status, 200, JSON.stringify(workspaces.data));
    assert.equal(workspaces.data.teams[0].ownerId, sofia.id);
    assert.equal(workspaces.data.teams[0].role, 'viewer');
  });

  const teamRequests = await api(`/api/messages/team/${sofia.id}/conversations?folder=requests`, {
    cookie: tom.cookie
  });
  check('the shared inbox exposes only business threads', () => {
    assert.equal(teamRequests.status, 200, JSON.stringify(teamRequests.data));
    assert.ok(teamRequests.data.items.some((item) => item._id === String(inboundRequest._id)));
    assert.ok(teamRequests.data.items.every((item) => item.businessThread));
    assert.ok(teamRequests.data.items.every((item) => item._id !== String(personalFixture._id)));
  });

  const viewerReply = await api(`/api/messages/team/${sofia.id}/conversations/${inboundRequest._id}/messages`, {
    method: 'POST',
    cookie: tom.cookie,
    body: { text: 'A viewer should never be able to send this.' }
  });
  check('viewer access is read-only at the API', () => {
    assert.equal(viewerReply.status, 403, JSON.stringify(viewerReply.data));
    assert.equal(viewerReply.data?.code, 'TEAM_READ_ONLY');
  });

  const promoted = await api(`/api/account/business/team/${tom.id}`, {
    method: 'PATCH',
    cookie: sofia.cookie,
    body: { role: 'agent' }
  });
  check('the owner can promote a viewer to agent', () => {
    assert.equal(promoted.status, 200, JSON.stringify(promoted.data));
    assert.equal(promoted.data.role, 'agent');
  });

  const teamAccepted = await api(`/api/messages/team/${sofia.id}/conversations/${inboundRequest._id}/accept`, {
    method: 'POST',
    cookie: tom.cookie
  });
  check('an agent can accept a business request', () => {
    assert.equal(teamAccepted.status, 200, JSON.stringify(teamAccepted.data));
    assert.equal(teamAccepted.data.conversation.state, 'active');
    assert.equal(teamAccepted.data.conversation.team.role, 'agent');
  });

  const teamReply = await api(`/api/messages/team/${sofia.id}/conversations/${inboundRequest._id}/messages`, {
    method: 'POST',
    cookie: tom.cookie,
    body: { text: 'Sofia\'s team is following up on the enquiry.' }
  });
  check('an agent can reply on behalf of the business', () => {
    assert.equal(teamReply.status, 201, JSON.stringify(teamReply.data));
    assert.equal(teamReply.data.message.text, 'Sofia\'s team is following up on the enquiry.');
    assert.equal(teamReply.data.conversation.canReply, true);
  });

  const teamInbox = await api(`/api/messages/team/${sofia.id}/conversations?folder=inbox`, {
    cookie: tom.cookie
  });
  check('the shared inbox excludes the owner\'s personal thread', () => {
    assert.equal(teamInbox.status, 200, JSON.stringify(teamInbox.data));
    assert.ok(teamInbox.data.items.every((item) => item.businessThread));
    assert.ok(teamInbox.data.items.every((item) => item._id !== String(personalFixture._id)));
    assert.ok(teamInbox.data.items.some((item) => item._id === String(inboundRequest._id)));
  });

  const nonMember = await api(`/api/messages/team/${sofia.id}/conversations`, {
    cookie: alex.cookie
  });
  check('a non-member cannot open the shared inbox', () => {
    assert.equal(nonMember.status, 404, JSON.stringify(nonMember.data));
  });

  const removed = await api(`/api/account/business/team/${tom.id}`, {
    method: 'DELETE',
    cookie: sofia.cookie
  });
  const afterRemoval = await api(`/api/messages/team/${sofia.id}/conversations`, { cookie: tom.cookie });
  check('removing a teammate revokes access immediately', () => {
    assert.equal(removed.status, 200, JSON.stringify(removed.data));
    assert.equal(afterRemoval.status, 404, JSON.stringify(afterRemoval.data));
  });

  for (const target of [mark, nina]) {
    const sent = await api('/api/messages/requests', {
      method: 'POST',
      cookie: sofia.cookie,
      body: {
        recipientId: target.id,
        text: `A short brief for ${target.username}.`,
        intent: 'collab',
        company: 'Sofia Studio'
      }
    });
    check(`a verified business can reach ${target.username}`, () => {
      assert.equal(sent.status, 201, JSON.stringify(sent.data));
    });
  }

  const markThread = await api('/api/messages/conversations?folder=requests', { cookie: mark.cookie });
  const ninaThread = await api('/api/messages/conversations?folder=requests', { cookie: nina.cookie });
  const reportTargets = [
    [alex, brief.data.conversation._id],
    [mark, markThread.data.items[0]._id],
    [nina, ninaThread.data.items[0]._id]
  ];
  for (const [target, conversationId] of reportTargets) {
    const reported = await api(`/api/messages/conversations/${conversationId}/report`, {
      method: 'POST',
      cookie: target.cookie,
      body: { reason: 'spam', note: 'Cold business outreach probe.', block: false }
    });
    check(`recipient ${target.username} can report a business brief`, () => {
      assert.equal(reported.status, 201, JSON.stringify(reported.data));
    });
  }

  const business = await BusinessProfile.findOne({ userId: sofia.id }).lean();
  check('three open reports pause business outreach', () => {
    assert.ok(business, 'missing business profile');
    assert.equal(business.complaints, 3);
    assert.equal(business.outreachPaused, true);
  });

  const paused = await api('/api/messages/requests', {
    method: 'POST',
    cookie: sofia.cookie,
    body: {
      recipientId: rita.id,
      text: 'A final brief while outreach is paused.',
      intent: 'collab',
      company: 'Sofia Studio'
    }
  });
  check('paused outreach refuses a new cold request', () => {
    assert.equal(paused.status, 403, JSON.stringify(paused.data));
    assert.match(String(paused.data?.message || ''), /paused/i);
  });

  const recoveryQueue = await api('/api/admin/business-verifications?status=pending', {
    cookie: admin.cookie
  });
  const pausedItem = recoveryQueue.data.items.find((item) => item.user?.username === 'biz13sofia');
  check('a paused verified business appears in the review queue', () => {
    assert.ok(pausedItem, 'missing paused business');
    assert.equal(pausedItem.business.outreachPaused, true);
  });

  const recovered = await api(`/api/admin/business-verifications/${pausedItem._id}/resolve`, {
    method: 'POST',
    cookie: admin.cookie,
    body: { status: 'verified', note: 'Reports reviewed; outreach resumed.' }
  });
  check('an admin can clear the outreach pause', () => {
    assert.equal(recovered.status, 200, JSON.stringify(recovered.data));
    assert.equal(recovered.data.unpaused, true);
  });

  const afterRecovery = await api('/api/messages/requests', {
    method: 'POST',
    cookie: sofia.cookie,
    body: {
      recipientId: rita.id,
      text: 'A fresh brief after the review was cleared.',
      intent: 'collab',
      company: 'Sofia Studio'
    }
  });
  check('clearing the pause restores verified cold outreach', () => {
    assert.equal(afterRecovery.status, 201, JSON.stringify(afterRecovery.data));
  });

  const manualProfile = await api('/api/account/business-profile', {
    method: 'POST',
    cookie: manual.cookie,
    body: {
      displayName: 'Manual Review Studio',
      category: 'brand',
      description: 'A business requesting manual review.'
    }
  });
  check('a business can be created without a website', () => {
    assert.equal(manualProfile.status, 200, JSON.stringify(manualProfile.data));
    assert.equal(manualProfile.data.businessProfile.verificationStatus, 'none');
  });

  const manualRequest = await api('/api/account/business-verification', {
    method: 'POST',
    cookie: manual.cookie,
    body: { method: 'manual' }
  });
  check('manual review is available without DNS', () => {
    assert.equal(manualRequest.status, 200, JSON.stringify(manualRequest.data));
    assert.equal(manualRequest.data.businessProfile.verificationMethod, 'manual');
    assert.equal(manualRequest.data.instructions.method, 'manual');
  });

  const manualQueue = await api('/api/admin/business-verifications?status=pending', {
    cookie: admin.cookie
  });
  const manualItem = manualQueue.data.items.find((item) => item.user?.username === 'biz13manual');
  check('the manual request enters the admin queue', () => {
    assert.ok(manualItem, 'missing manual business');
  });

  const rejected = await api(`/api/admin/business-verifications/${manualItem._id}/resolve`, {
    method: 'POST',
    cookie: admin.cookie,
    body: { status: 'rejected', note: 'No verifiable domain supplied.' }
  });
  check('an admin can reject a business request', () => {
    assert.equal(rejected.status, 200, JSON.stringify(rejected.data));
    assert.equal(rejected.data.status, 'rejected');
  });

  const notBusiness = await api('/api/business/biz13alex');
  check('a personal profile is not exposed as a business', () => {
    assert.equal(notBusiness.status, 404, JSON.stringify(notBusiness.data));
  });
}

async function run() {
  await connectDB();
  console.log(`Using throwaway database: ${E2E_DB}`);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  setBase(`http://127.0.0.1:${server.address().port}`);

  const sofia = await registerUser('biz13sofia', { probeId: true });
  const alex = await registerUser('biz13alex', { probeId: true });
  const dana = await registerUser('biz13dana', { probeId: true });
  const mark = await registerUser('biz13mark', { probeId: true });
  const nina = await registerUser('biz13nina', { probeId: true });
  const rita = await registerUser('biz13rita', { probeId: true });
  const manual = await registerUser('biz13manual', { probeId: true });
  const admin = await registerUser('biz13admin', { probeId: true });
  const tom = await registerUser('biz13tom', { probeId: true });

  try {
    await scenarios({ sofia, alex, dana, mark, nina, rita, manual, admin, tom });
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
