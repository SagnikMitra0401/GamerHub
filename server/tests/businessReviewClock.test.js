const test = require('node:test');
const assert = require('node:assert/strict');

// Every collaborator with a side effect is stubbed before the controller
// destructures it, so this suite never sends email, writes audit rows or does
// a DNS lookup.
const audit = require('../utils/audit');
const email = require('../utils/email');
const domainVerification = require('../utils/domainVerification');

const originalAudit = audit.recordPlatformAudit;
const originalReviewEmail = email.sendBusinessReviewEmail;
const originalCheckDns = domainVerification.checkDnsToken;

audit.recordPlatformAudit = async () => null;
email.sendBusinessReviewEmail = async () => ({ id: 'test' });
domainVerification.checkDnsToken = async ({ domain }) => ({
  ok: true,
  domain,
  recordName: `_gamerhub-verify.${domain}`,
});

const BusinessProfile = require('../models/BusinessProfile');
const BusinessTeamMember = require('../models/BusinessTeamMember');
const BusinessVerificationAudit = require('../models/BusinessVerificationAudit');
const User = require('../models/User');

const {
  saveBusinessProfile,
  requestBusinessVerification,
  checkBusinessVerification,
  resolveBusinessVerification,
  demoteBusinessAccount,
} = require('../controllers/businessController');

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY);

const originals = {
  profileFindById: BusinessProfile.findById,
  profileFindOne: BusinessProfile.findOne,
  profileFindOneAndUpdate: BusinessProfile.findOneAndUpdate,
  userFindById: User.findById,
  userUpdateOne: User.updateOne,
  teamUpdateMany: BusinessTeamMember.updateMany,
  auditCreate: BusinessVerificationAudit.create,
};
const audits = [];

test.beforeEach(() => {
  audits.length = 0;
  BusinessVerificationAudit.create = async (payload) => {
    audits.push(payload);
    return payload;
  };
  User.findById = () => ({
    select: () => ({
      lean: async () => ({ _id: 'c'.repeat(24), profileType: 'creator_business' }),
    }),
  });
  User.updateOne = async () => ({ modifiedCount: 1 });
  BusinessTeamMember.updateMany = async () => ({ modifiedCount: 0 });
});

test.after(() => {
  BusinessProfile.findById = originals.profileFindById;
  BusinessProfile.findOne = originals.profileFindOne;
  BusinessProfile.findOneAndUpdate = originals.profileFindOneAndUpdate;
  User.findById = originals.userFindById;
  User.updateOne = originals.userUpdateOne;
  BusinessTeamMember.updateMany = originals.teamUpdateMany;
  BusinessVerificationAudit.create = originals.auditCreate;
  audit.recordPlatformAudit = originalAudit;
  email.sendBusinessReviewEmail = originalReviewEmail;
  domainVerification.checkDnsToken = originalCheckDns;
});

test('a manual verification stamps the evidence-retention clock', async () => {
  const profile = fakeProfile({ verificationStatus: 'pending', reviewDecidedAt: null });
  BusinessProfile.findById = async () => profile;

  const result = await invoke(resolveBusinessVerification, {
    params: { id: profile._id },
    body: { status: 'verified', note: 'Registry checked.' },
    user: { _id: 'd'.repeat(24) },
  });

  assert.equal(result.failure, null, result.failure?.message);
  assert.equal(profile.verificationStatus, 'verified');
  assert.ok(profile.reviewDecidedAt instanceof Date, 'reviewDecidedAt must be stamped');
  assert.ok(Math.abs(Date.now() - profile.reviewDecidedAt.getTime()) < 5000);
  assert.equal(audits[0].status, 'verified');
});

test('a rejection stamps the evidence-retention clock', async () => {
  const profile = fakeProfile({ verificationStatus: 'pending', reviewDecidedAt: null });
  BusinessProfile.findById = async () => profile;

  const result = await invoke(resolveBusinessVerification, {
    params: { id: profile._id },
    body: { status: 'rejected', note: 'Proof does not match the business.' },
    user: { _id: 'd'.repeat(24) },
  });

  assert.equal(result.failure, null, result.failure?.message);
  assert.equal(profile.verificationStatus, 'rejected');
  assert.equal(profile.verifiedAt, null);
  assert.ok(profile.reviewDecidedAt instanceof Date, 'reviewDecidedAt must be stamped');
  assert.equal(audits[0].status, 'rejected');
});

test('an automatic DNS match stamps the evidence-retention clock', async () => {
  const profile = fakeProfile({
    verificationStatus: 'pending',
    verificationMethod: 'dns',
    verificationDomain: 'neonrift.example',
    verificationToken: 'token-value',
    reviewDecidedAt: null,
  });
  BusinessProfile.findOne = async () => profile;

  const result = await invoke(checkBusinessVerification, {
    user: { _id: 'c'.repeat(24) },
  });

  assert.equal(result.failure, null, result.failure?.message);
  assert.equal(profile.verificationStatus, 'verified');
  assert.ok(profile.verifiedAt instanceof Date);
  assert.ok(profile.reviewDecidedAt instanceof Date, 'reviewDecidedAt must be stamped');
  assert.equal(profile.verificationToken, '');
  assert.equal(audits[0].status, 'verified');
});

test('demotion stamps the evidence-retention clock', async () => {
  const profile = fakeProfile({
    verificationStatus: 'verified',
    verificationRequestedAt: ago(9),
    reviewContactedAt: ago(8),
    reviewDecidedAt: ago(30),
  });
  BusinessProfile.findById = async () => profile;

  const result = await invoke(demoteBusinessAccount, {
    params: { id: profile._id },
    body: { reason: 'The listing does not identify this business.' },
    user: { _id: 'd'.repeat(24) },
  });

  assert.equal(result.failure, null, result.failure?.message);
  assert.equal(result.response.payload?.demoted, true);
  assert.ok(profile.reviewDecidedAt instanceof Date);
  assert.ok(profile.reviewDecidedAt > ago(1), 'the demotion must reset the clock to now');
  assert.ok(Math.abs(Date.now() - profile.reviewDecidedAt.getTime()) < 5000);
});

test('a new verification request clears the decision clock and old correspondence', async () => {
  const profile = fakeProfile({
    verificationStatus: 'rejected',
    website: 'https://neonrift.example',
    reviewDecidedAt: ago(400),
    reviewContactedAt: ago(410),
    reviewRespondedAt: ago(405),
    reviewResponseNote: 'The old answer to the old review.',
  });
  BusinessProfile.findOne = async () => profile;

  const result = await invoke(requestBusinessVerification, {
    user: { _id: 'c'.repeat(24) },
    body: { method: 'dns' },
  });

  assert.equal(result.failure, null, result.failure?.message);
  assert.equal(profile.reviewDecidedAt, null, 'a fresh application restarts the clock');
  assert.equal(profile.reviewContactedAt, null);
  assert.equal(profile.reviewRespondedAt, null);
  assert.equal(profile.reviewResponseNote, '');
  assert.equal(profile.verificationStatus, 'pending');
});

test('editing the website no longer postpones evidence retention', async () => {
  const decidedAt = ago(700);
  const existing = fakeProfile({
    verificationStatus: 'verified',
    website: 'https://old.example',
    reviewDecidedAt: decidedAt,
  });
  const saved = { ...existing, verificationStatus: 'none', website: 'https://new.example' };

  BusinessProfile.findOne = () => ({ lean: async () => existing });
  let updatePayload = null;
  BusinessProfile.findOneAndUpdate = (filter, update) => {
    updatePayload = update.$set;
    return { lean: async () => saved };
  };

  const result = await invoke(saveBusinessProfile, {
    user: { _id: 'c'.repeat(24) },
    body: {
      displayName: 'Neon Rift Studio',
      website: 'https://new.example',
      contactEmail: 'legal@neonrift.example',
    },
  });

  assert.equal(result.failure, null, result.failure?.message);
  assert.equal(
    updatePayload.verificationStatus,
    'none',
    'a domain change still resets verification',
  );
  assert.equal(
    'reviewDecidedAt' in updatePayload,
    false,
    'a profile edit must not move or clear the past decision',
  );
});

// ── helpers ────────────────────────────────────────────────────────────────

function fakeProfile(overrides = {}) {
  return {
    _id: 'b'.repeat(24),
    userId: 'c'.repeat(24),
    displayName: 'Neon Rift Studio',
    category: 'studio',
    description: '',
    website: 'https://neonrift.example',
    supportEmail: 'hello@neonrift.example',
    contactEmail: 'legal@neonrift.example',
    contactMethod: 'email',
    contactDetail: '',
    proofType: 'registration',
    proofUrl: 'https://registry.example/neon-rift',
    proofNote: 'Registry entry.',
    timezone: '',
    responseExpectation: '',
    links: [],
    verificationStatus: 'pending',
    verificationMethod: null,
    verificationDomain: '',
    verificationToken: '',
    verificationRequestedAt: null,
    verifiedAt: null,
    verifiedBy: null,
    reviewContactedAt: null,
    reviewRespondedAt: null,
    reviewResponseNote: '',
    reviewDecidedAt: null,
    evidencePurgedAt: null,
    demotedAt: null,
    demotionReason: '',
    outreachPaused: false,
    saves: 0,
    ...overrides,
    async save() {
      this.saves += 1;
      return this;
    },
  };
}

async function invoke(handler, req) {
  const response = {
    payload: null,
    statusCode: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  let failure = null;
  await handler(req, response, (err) => {
    failure = err;
  });
  return { failure, response };
}
