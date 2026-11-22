/**
 * Phase 17 end-to-end verification — business review lifecycle and retention.
 *
 * Covers the whole review chain over HTTP: evidence-gated application, reviewer
 * contact, the owner's in-app answer, verification, the response-window guard
 * and demotion. The retention half drives the real sweeps against the throwaway
 * database and checks the audit rows and owner notices they produce.
 *
 * Runs against a THROWAWAY database on the same cluster:
 *   node scripts/e2e-phase17.js
 */
require('dotenv').config();
const http = require('http');
const assert = require('assert/strict');
const mongoose = require('mongoose');

const E2E_DB = `gamerhub_e2e17_${Date.now().toString(36)}`;

function tempMongoUri() {
  const url = new URL(process.env.MONGO_URI);
  url.pathname = `/${E2E_DB}`;
  return url.toString();
}

process.env.MONGO_URI = tempMongoUri();
process.env.NODE_ENV = 'test';
process.env.EMAIL_TRANSPORT = 'memory';
process.env.CLIENT_URL = 'http://localhost:3000';
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.DM_SETTINGS_RATE_LIMIT_MAX = '1000';
process.env.DISABLE_RETENTION_WORKER = '1';

const connectDB = require('../server/config/db');
const app = require('../server/app');
const { closeDomainConnections } = require('../server/config/connections');

const User = require('../server/models/User');
const BusinessProfile = require('../server/models/BusinessProfile');
const BusinessVerificationAudit = require('../server/models/BusinessVerificationAudit');
const Notification = require('../server/models/Notification');
const AuditLog = require('../server/models/AuditLog');
const { getOutbox, resetOutbox } = require('../server/utils/email');
const {
  monthsBefore,
  expireAbandonedBusinessApplications,
  purgeExpiredBusinessEvidence
} = require('../server/utils/businessRetention');
const { notifyBusinessRetention } = require('../server/utils/businessRetentionNotices');

const { api, check, report, setBase, registerUser } = require('./lib/e2e-harness');

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days) => new Date(Date.now() - days * DAY);

const businessBody = (displayName, address, website = 'https://olive.example') => ({
  displayName,
  category: 'studio',
  description: 'An independent studio used by the phase 17 review lifecycle test.',
  website,
  supportEmail: address,
  contactEmail: address,
  contactMethod: 'email',
  proofType: 'registration',
  proofUrl: `${website}/registration`,
  proofNote: 'Company registration record is available at the proof link.'
});

async function applyForManualReview(user, body) {
  const saved = await api('/api/account/business-profile', {
    method: 'POST',
    cookie: user.cookie,
    body
  });
  assert.equal(saved.status, 200, `save business profile: ${JSON.stringify(saved.data)}`);
  const requested = await api('/api/account/business-verification', {
    method: 'POST',
    cookie: user.cookie,
    body: { method: 'manual' }
  });
  assert.equal(requested.status, 200, `request review: ${JSON.stringify(requested.data)}`);
  return BusinessProfile.findOne({ userId: user.id }).lean();
}

async function scenarios({ olive, peri, quinn, rosa, admin }) {
  await User.updateOne({ _id: admin.id }, { $set: { role: 'admin' } });
  resetOutbox();

  // ── Evidence gate ─────────────────────────────────────────────────────────
  await api('/api/account/business-profile', {
    method: 'POST',
    cookie: olive.cookie,
    body: {
      displayName: 'Olive Interactive',
      category: 'studio',
      website: 'https://olive.example',
      supportEmail: 'hello@olive.example'
    }
  });
  const noEvidence = await api('/api/account/business-verification', {
    method: 'POST',
    cookie: olive.cookie,
    body: { method: 'manual' }
  });
  check('manual review refuses an application with no evidence', () => {
    assert.equal(noEvidence.status, 400, JSON.stringify(noEvidence.data));
    assert.match(String(noEvidence.data?.message || ''), /proof|evidence/i);
  });

  const withEvidence = await api('/api/account/business-profile', {
    method: 'POST',
    cookie: olive.cookie,
    body: businessBody('Olive Interactive', 'legal@olive.example')
  });
  check('the official contact and proof are stored on the profile', () => {
    assert.equal(withEvidence.status, 200, JSON.stringify(withEvidence.data));
    assert.equal(withEvidence.data.businessProfile.contactEmail, 'legal@olive.example');
    assert.equal(withEvidence.data.businessProfile.proofType, 'registration');
    assert.match(withEvidence.data.businessProfile.proofUrl, /registration$/);
  });

  const requested = await api('/api/account/business-verification', {
    method: 'POST',
    cookie: olive.cookie,
    body: { method: 'manual' }
  });
  check('a complete application waits for a manual decision', () => {
    assert.equal(requested.status, 200, JSON.stringify(requested.data));
    assert.equal(requested.data.businessProfile.verificationStatus, 'pending');
    assert.equal(requested.data.businessProfile.verificationMethod, 'manual');
    assert.equal(requested.data.businessProfile.reviewDecidedAt, null);
  });

  const oliveProfile = await BusinessProfile.findOne({ userId: olive.id }).lean();

  const queue = await api('/api/admin/business-verifications?status=pending', {
    cookie: admin.cookie
  });
  const queueItem = queue.data?.items?.find((item) => item.user?.username === 'biz17olive');
  check('the review queue shows the evidence and blocks demotion before contact', () => {
    assert.equal(queue.status, 200, JSON.stringify(queue.data));
    assert.ok(queueItem, 'missing pending application');
    assert.equal(queueItem.business.contactEmail, 'legal@olive.example');
    assert.equal(queueItem.business.proofType, 'registration');
    assert.equal(queueItem.demotion.canDemote, false);
    assert.equal(queueItem.demotion.code, 'BUSINESS_CONTACT_REQUIRED');
  });

  // ── Contact and response window ───────────────────────────────────────────
  const contact = await api(`/api/admin/business-verifications/${queueItem._id}/contact`, {
    method: 'POST',
    cookie: admin.cookie,
    body: {
      channel: 'email',
      message: 'Please confirm the legal entity name and the registration number.'
    }
  });
  check('a reviewer records the official contact', () => {
    assert.equal(contact.status, 200, JSON.stringify(contact.data));
    assert.equal(contact.data.contacted, true);
    assert.ok(contact.data.reviewContactedAt);
  });

  const contactMail = getOutbox().find((mail) => mail.to === 'legal@olive.example');
  check('the contact email reaches the official address', () => {
    assert.ok(contactMail, 'no review email for the official contact');
    assert.match(contactMail.subject, /verification/i);
    assert.match(contactMail.text, /legal entity/i);
  });

  const earlyDemotion = await api(`/api/admin/business-verifications/${queueItem._id}/demote`, {
    method: 'POST',
    cookie: admin.cookie,
    body: { reason: 'The registration evidence could not be confirmed.' }
  });
  check('demotion is refused while the response window is open', () => {
    assert.equal(earlyDemotion.status, 409, JSON.stringify(earlyDemotion.data));
    assert.equal(earlyDemotion.data.code, 'BUSINESS_RESPONSE_WINDOW');
  });

  const tooShort = await api('/api/account/business-verification/respond', {
    method: 'POST',
    cookie: olive.cookie,
    body: { note: 'ok' }
  });
  check('an answer must actually explain the business position', () => {
    assert.equal(tooShort.status, 400, JSON.stringify(tooShort.data));
  });

  const answer = await api('/api/account/business-verification/respond', {
    method: 'POST',
    cookie: olive.cookie,
    body: {
      note: 'The legal name is Olive Interactive Ltd and the registration number is 12345678.'
    }
  });
  check('the owner can answer the review from settings', () => {
    assert.equal(answer.status, 200, JSON.stringify(answer.data));
    assert.ok(answer.data.businessProfile.reviewRespondedAt);
    assert.match(answer.data.businessProfile.reviewResponseNote, /12345678/);
  });

  const queueAfterAnswer = await api('/api/admin/business-verifications?status=pending', {
    cookie: admin.cookie
  });
  const answeredItem = queueAfterAnswer.data?.items?.find((item) => item.user?.username === 'biz17olive');
  check('the reviewer reads the answer next to the evidence', () => {
    assert.ok(answeredItem, 'missing application after the answer');
    assert.match(answeredItem.business.reviewResponseNote, /12345678/);
    assert.ok(answeredItem.business.reviewRespondedAt);
  });

  // ── Verification ──────────────────────────────────────────────────────────
  const verified = await api(`/api/admin/business-verifications/${queueItem._id}/resolve`, {
    method: 'POST',
    cookie: admin.cookie,
    body: { status: 'verified', note: 'Registration checked against the public record.' }
  });
  check('a reviewer can verify the application', () => {
    assert.equal(verified.status, 200, JSON.stringify(verified.data));
    assert.equal(verified.data.status, 'verified');
    assert.ok(verified.data.businessProfile.verifiedAt);
    assert.ok(verified.data.businessProfile.reviewDecidedAt, 'decision starts the evidence clock');
  });

  const ownerAccount = await api('/api/account', { cookie: olive.cookie });
  check('the account becomes a verified business', () => {
    assert.equal(ownerAccount.status, 200, JSON.stringify(ownerAccount.data));
    assert.equal(ownerAccount.data.profileType, 'creator_business');
    assert.equal(ownerAccount.data.businessProfile.verificationStatus, 'verified');
  });

  const publicCard = await api('/api/business/biz17olive');
  check('the public card publishes the verified badge state', () => {
    assert.equal(publicCard.status, 200, JSON.stringify(publicCard.data));
    assert.equal(publicCard.data.business.verificationStatus, 'verified');
    assert.equal(publicCard.data.profileType, 'creator_business');
  });

  // ── Demotion after the window ─────────────────────────────────────────────
  // Timestamps are immutable in Mongoose, so the fixture writes the raw
  // collection: request nine days ago, contact eight days ago.
  await BusinessProfile.collection.updateOne(
    { _id: oliveProfile._id },
    { $set: { verificationRequestedAt: daysAgo(9), reviewContactedAt: daysAgo(8) } }
  );

  const demoted = await api(`/api/admin/business-verifications/${queueItem._id}/demote`, {
    method: 'POST',
    cookie: admin.cookie,
    body: { reason: 'The registration evidence belongs to a different company.' }
  });
  check('demotion succeeds once the response window has passed', () => {
    assert.equal(demoted.status, 200, JSON.stringify(demoted.data));
    assert.equal(demoted.data.demoted, true);
    assert.ok(demoted.data.businessProfile.demotedAt);
    assert.ok(demoted.data.businessProfile.reviewDecidedAt);
    assert.equal(demoted.data.businessProfile.verificationStatus, 'none');
  });

  const demotedAccount = await api('/api/account', { cookie: olive.cookie });
  check('the demoted account returns to a personal profile', () => {
    assert.equal(demotedAccount.status, 200, JSON.stringify(demotedAccount.data));
    assert.equal(demotedAccount.data.profileType, 'personal');
  });

  const afterDemotion = await api('/api/business/biz17olive');
  check('the public business card is gone after demotion', () => {
    assert.equal(afterDemotion.status, 404, JSON.stringify(afterDemotion.data));
  });

  const demotionAudits = await BusinessVerificationAudit.countDocuments({
    businessProfileId: oliveProfile._id,
    status: 'demoted'
  });
  const demotionMail = getOutbox().find(
    (mail) => mail.to === 'legal@olive.example' && /personal profile/i.test(mail.subject)
  );
  check('the demotion is audited and explained to the official contact', () => {
    assert.equal(demotionAudits, 1);
    assert.ok(demotionMail, 'no demotion email');
  });

  const platformAudits = await AuditLog.distinct('actionType', {
    targetId: oliveProfile._id,
    targetModel: 'BusinessProfile'
  });
  check('contact, answer and demotion reach the platform audit log', () => {
    for (const action of ['PLATFORM_BUSINESS_CONTACT', 'PLATFORM_BUSINESS_RESPOND', 'PLATFORM_BUSINESS_DEMOTE']) {
      assert.ok(platformAudits.includes(action), `missing ${action}`);
    }
  });

  const reviewAuditStatuses = await BusinessVerificationAudit.distinct('status', {
    businessProfileId: oliveProfile._id
  });
  check('the review trail keeps contact, answer, decision and demotion', () => {
    for (const status of ['contacted', 'responded', 'verified', 'demoted']) {
      assert.ok(reviewAuditStatuses.includes(status), `missing ${status} audit row`);
    }
  });

  // ── Abandoned application expiry ──────────────────────────────────────────
  const periProfile = await applyForManualReview(
    peri,
    businessBody('Peri Publishing', 'ops@peri.example', 'https://peri.example')
  );
  await BusinessProfile.collection.updateOne(
    { _id: periProfile._id },
    {
      $set: {
        verificationRequestedAt: daysAgo(120),
        updatedAt: daysAgo(100),
        verificationToken: 'expiry-token'
      }
    }
  );

  resetOutbox();
  const expiry = await expireAbandonedBusinessApplications();
  const periAfterExpiry = await BusinessProfile.findById(periProfile._id).lean();
  check('an application idle for 90 days is closed as expired', () => {
    assert.ok(expiry.expired >= 1, 'sweep expired nothing');
    assert.equal(periAfterExpiry.verificationStatus, 'expired');
    assert.equal(periAfterExpiry.verificationToken, '');
    assert.equal(periAfterExpiry.verificationMethod, null);
    assert.ok(periAfterExpiry.reviewDecidedAt, 'expiry starts the evidence clock');
  });

  check('expiry keeps the evidence so it can be reviewed until the clock ends', () => {
    assert.equal(periAfterExpiry.contactEmail, 'ops@peri.example');
    assert.match(periAfterExpiry.proofNote, /registration/i);
  });

  const expiryAudit = await BusinessVerificationAudit.countDocuments({
    businessProfileId: periProfile._id,
    status: 'expired'
  });
  const expiryClaim = expiry.claims.find((claim) => claim.id === String(periProfile._id));
  check('expiry writes one audit row and claims the owner for notice', () => {
    assert.equal(expiryAudit, 1);
    assert.ok(expiryClaim, 'expired profile missing from the notice claims');
    assert.equal(expiryClaim.userId, String(peri.id));
  });

  const expiryNotices = await notifyBusinessRetention(expiry.claims, { kind: 'expired' });
  const expiryMail = getOutbox().find(
    (mail) => mail.to === 'ops@peri.example' && /expired/i.test(mail.subject)
  );
  check('the owner is told about the lapse in-app and by email', () => {
    assert.ok(expiryNotices.notified >= 1, 'no in-app notice');
    assert.ok(expiryMail, 'no expiry email');
    assert.match(expiryMail.text, /90 days/);
  });

  const periNotice = await Notification.findOne({
    userId: peri.id,
    dedupeKey: /^business-verification-expired:/
  }).lean();
  check('the expiry notice is durable rather than a 15-day ping', () => {
    assert.ok(periNotice, 'no stored notification');
    assert.equal(periNotice.retentionAt, null);
    assert.equal(periNotice.metadata.important, true);
    assert.equal(periNotice.actionUrl, '/settings?tab=business');
  });

  const periAccount = await api('/api/account', { cookie: peri.cookie });
  check('the owner sees the expired state in settings', () => {
    assert.equal(periAccount.status, 200, JSON.stringify(periAccount.data));
    assert.equal(periAccount.data.businessProfile.verificationStatus, 'expired');
  });

  // ── Absolute 12-month cap ─────────────────────────────────────────────────
  const quinnProfile = await applyForManualReview(
    quinn,
    businessBody('Quinn Quarterlies', 'legal@quinn.example', 'https://quinn.example')
  );
  await BusinessProfile.collection.updateOne(
    { _id: quinnProfile._id },
    { $set: { verificationRequestedAt: daysAgo(400) } }
  );
  const capSweep = await expireAbandonedBusinessApplications();
  const quinnAfterCap = await BusinessProfile.findById(quinnProfile._id).lean();
  check('a year-old application expires even though it was edited recently', () => {
    assert.ok(capSweep.expired >= 1, 'sweep expired nothing');
    assert.equal(quinnAfterCap.verificationStatus, 'expired');
  });

  // ── Evidence purge ────────────────────────────────────────────────────────
  const rosaProfile = await BusinessProfile.create({
    userId: rosa.id,
    displayName: 'Rosa Retrospective',
    category: 'creator',
    contactEmail: 'legal@rosa.example',
    supportEmail: 'hello@rosa.example',
    contactDetail: '',
    proofType: 'registration',
    proofUrl: 'https://rosa.example/registration',
    proofNote: 'Registration evidence from 2024.',
    reviewResponseNote: 'The registration was confirmed in 2024.',
    verificationStatus: 'verified',
    verifiedAt: monthsBefore(new Date(), 25),
    reviewDecidedAt: monthsBefore(new Date(), 25)
  });
  const recentProfile = await BusinessProfile.create({
    userId: new mongoose.Types.ObjectId(),
    displayName: 'Recent Review',
    category: 'creator',
    contactEmail: 'legal@recent.example',
    proofUrl: 'https://recent.example/registration',
    proofNote: 'Still inside the retention window.',
    verificationStatus: 'verified',
    verifiedAt: monthsBefore(new Date(), 23),
    reviewDecidedAt: monthsBefore(new Date(), 23)
  });

  resetOutbox();
  const purge = await purgeExpiredBusinessEvidence();
  const rosaAfterPurge = await BusinessProfile.findById(rosaProfile._id).lean();
  const recentAfterPurge = await BusinessProfile.findById(recentProfile._id).lean();
  check('evidence older than 24 months is cleared in place', () => {
    assert.equal(purge.profiles, 1, `purged ${purge.profiles} profile(s)`);
    assert.equal(rosaAfterPurge.contactEmail, '');
    assert.equal(rosaAfterPurge.proofUrl, '');
    assert.equal(rosaAfterPurge.proofNote, '');
    assert.equal(rosaAfterPurge.reviewResponseNote, '');
    assert.ok(rosaAfterPurge.evidencePurgedAt);
  });

  check('the public card and a recent review are untouched', () => {
    assert.equal(rosaAfterPurge.displayName, 'Rosa Retrospective');
    assert.equal(recentAfterPurge.contactEmail, 'legal@recent.example');
    assert.equal(recentAfterPurge.evidencePurgedAt, null);
  });

  const purgeClaim = purge.claims.find((claim) => claim.id === String(rosaProfile._id));
  check('the purge captures the recipient before clearing the contact', () => {
    assert.ok(purgeClaim, 'purged profile missing from the notice claims');
    assert.equal(purgeClaim.contactEmail, 'legal@rosa.example');
  });

  const purgeNotices = await notifyBusinessRetention(purge.claims, { kind: 'purged' });
  const purgeMail = getOutbox().find(
    (mail) => mail.to === 'legal@rosa.example' && /evidence/i.test(mail.subject)
  );
  check('the owner is told that the evidence window closed', () => {
    assert.equal(purgeNotices.notified, 1);
    assert.ok(purgeMail, 'no purge email');
    assert.match(purgeMail.text, /24-month/);
    assert.match(purgeMail.text, /\d{4}-\d{2}-\d{2}/);
  });

  const rosaNotice = await Notification.findOne({
    userId: rosa.id,
    dedupeKey: /^business-evidence-purged:/
  }).lean();
  const rosaAccount = await api('/api/account', { cookie: rosa.cookie });
  check('the purge notice is durable and visible with the purged profile', () => {
    assert.ok(rosaNotice, 'no stored notification');
    assert.equal(rosaNotice.retentionAt, null);
    assert.equal(rosaAccount.status, 200, JSON.stringify(rosaAccount.data));
    assert.ok(rosaAccount.data.businessProfile.evidencePurgedAt);
    assert.equal(rosaAccount.data.businessProfile.contactEmail, '');
  });
}

async function run() {
  await connectDB();
  console.log(`Using throwaway database: ${E2E_DB}`);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  setBase(`http://127.0.0.1:${server.address().port}`);

  const olive = await registerUser('biz17olive', { probeId: true });
  const peri = await registerUser('biz17peri', { probeId: true });
  const quinn = await registerUser('biz17quinn', { probeId: true });
  const rosa = await registerUser('biz17rosa', { probeId: true });
  const admin = await registerUser('biz17admin', { probeId: true });

  try {
    await scenarios({ olive, peri, quinn, rosa, admin });
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
