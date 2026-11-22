const test = require('node:test');
const assert = require('node:assert/strict');

// Stub the side-effectful collaborators before the controller captures them.
const audit = require('../utils/audit');
const email = require('../utils/email');
const originalAudit = audit.recordPlatformAudit;
const originalReviewEmail = email.sendBusinessReviewEmail;
const sent = [];
const audits = [];

// Both stubs must exist before the controller destructures them, or the test
// would fall through to the real transport.
audit.recordPlatformAudit = async () => null;
email.sendBusinessReviewEmail = async (payload) => {
  sent.push(payload);
  return { id: 'test' };
};

const BusinessProfile = require('../models/BusinessProfile');
const BusinessVerificationAudit = require('../models/BusinessVerificationAudit');
const User = require('../models/User');

const {
  contactBusinessVerification,
  respondToBusinessReview
} = require('../controllers/businessController');
const { demotionReadiness } = require('../utils/business');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const ago = (days) => new Date(NOW - days * DAY);

const originals = {
  profileFindById: BusinessProfile.findById,
  profileFindOne: BusinessProfile.findOne,
  userFindById: User.findById,
  auditCreate: BusinessVerificationAudit.create
};

test.beforeEach(() => {
  sent.length = 0;
  audits.length = 0;
  BusinessVerificationAudit.create = async (payload) => {
    audits.push(payload);
    return payload;
  };
  User.findById = () => ({
    select: () => ({ lean: async () => ({ username: 'neonrift', email: 'owner@example.com' }) })
  });
});

test.after(() => {
  BusinessProfile.findById = originals.profileFindById;
  BusinessProfile.findOne = originals.profileFindOne;
  User.findById = originals.userFindById;
  BusinessVerificationAudit.create = originals.auditCreate;
  audit.recordPlatformAudit = originalAudit;
  email.sendBusinessReviewEmail = originalReviewEmail;
});

test('a repeat contact clears the previous answer and restarts the window', async () => {
  const oldContact = ago(10);
  const profile = fakeProfile({
    verificationStatus: 'pending',
    verificationRequestedAt: ago(12),
    reviewContactedAt: oldContact,
    reviewRespondedAt: ago(9.5),
    reviewResponseNote: 'The old answer, which must not survive a new question.'
  });

  const result = await invokeContact(profile, {
    message: 'The registry page you sent no longer resolves. Please send a working filing link.'
  });

  assert.equal(result.failure, null, result.failure?.message);
  assert.equal(profile.saves, 1);
  assert.equal(profile.reviewRespondedAt, null, 'the old answer must be cleared');
  assert.equal(profile.reviewResponseNote, '');
  assert.ok(profile.reviewContactedAt > oldContact, 'the window starts from the new contact');

  const readiness = demotionReadiness(profile);
  assert.equal(readiness.ok, false);
  assert.equal(readiness.code, 'BUSINESS_RESPONSE_WINDOW');
  assert.equal(readiness.daysRemaining, 7);
  assert.equal(
    readiness.earliestDemotionAt.getTime(),
    profile.reviewContactedAt.getTime() + 7 * DAY
  );

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'review-contact@neonrift.example');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].status, 'contacted');
});

test('the contact audit keeps an excerpt, not the whole message body', async () => {
  const profile = fakeProfile({
    verificationStatus: 'pending',
    verificationRequestedAt: ago(2),
    reviewContactedAt: null
  });
  const longMessage = `${'Please send the corrected filing. '.repeat(12)}TAIL-MARKER-SHOULD-NOT-BE-STORED`;

  const result = await invokeContact(profile, { message: longMessage });

  assert.equal(result.failure, null, result.failure?.message);
  const note = audits[0].note;
  assert.ok(note.startsWith('email contact: '));
  assert.ok(note.length <= 160, `audit note was ${note.length} characters`);
  assert.equal(note.includes('TAIL-MARKER-SHOULD-NOT-BE-STORED'), false);
});

test('a verified business may answer a review contact', async () => {
  const profile = fakeProfile({
    verificationStatus: 'verified',
    verificationRequestedAt: ago(40),
    verifiedAt: ago(30),
    reviewContactedAt: ago(1)
  });
  BusinessProfile.findOne = async () => profile;

  const result = await invokeRespond(profile, {
    note: 'The registry entry is under the trading name; the filing names the same director.'
  });

  assert.equal(result.failure, null, result.failure?.message);
  assert.equal(result.response.payload?.responded, true);
  assert.equal(profile.saves, 1);
  assert.ok(profile.reviewRespondedAt instanceof Date);
  assert.match(profile.reviewResponseNote, /trading name/);
  assert.equal(audits[0].status, 'responded');
  assert.equal('proofUrl' in result.response.payload.businessProfile, true);
});

test('a pending business may answer a review contact', async () => {
  const profile = fakeProfile({
    verificationStatus: 'pending',
    verificationRequestedAt: ago(3),
    reviewContactedAt: ago(1)
  });
  BusinessProfile.findOne = async () => profile;

  const result = await invokeRespond(profile, { note: 'Here is the corrected public filing link.' });

  assert.equal(result.failure, null, result.failure?.message);
  assert.equal(result.response.payload?.responded, true);
  assert.equal(profile.reviewResponseNote, 'Here is the corrected public filing link.');
});

test('a rejected application and a profile with no contact cannot answer', async () => {
  const rejected = fakeProfile({
    verificationStatus: 'rejected',
    verificationRequestedAt: ago(5),
    reviewContactedAt: ago(4)
  });
  BusinessProfile.findOne = async () => rejected;
  const rejectedResult = await invokeRespond(rejected, { note: 'This rejection should not be answerable.' });
  assert.equal(rejectedResult.failure?.statusCode, 400);
  assert.match(rejectedResult.failure.message, /not awaiting a response/i);
  assert.equal(rejected.saves, 0);

  const neverContacted = fakeProfile({
    verificationStatus: 'pending',
    verificationRequestedAt: ago(2),
    reviewContactedAt: null
  });
  BusinessProfile.findOne = async () => neverContacted;
  const noContactResult = await invokeRespond(neverContacted, { note: 'There is no review contact to answer.' });
  assert.equal(noContactResult.failure?.statusCode, 400);
  assert.match(noContactResult.failure.message, /no review contact/i);
});

// ── helpers ────────────────────────────────────────────────────────────────

function fakeProfile(overrides = {}) {
  return {
    _id: 'b'.repeat(24),
    userId: 'c'.repeat(24),
    displayName: 'Neon Rift Studio',
    contactEmail: 'review-contact@neonrift.example',
    supportEmail: '',
    contactMethod: 'email',
    verificationStatus: 'pending',
    verificationMethod: 'manual',
    verificationDomain: '',
    verificationToken: '',
    verificationRequestedAt: null,
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
    }
  };
}

function fakeResponse() {
  return {
    payload: null,
    statusCode: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

async function invokeContact(profile, { message, channel = 'email' } = {}) {
  BusinessProfile.findById = async () => profile;
  const response = fakeResponse();
  let failure = null;
  await contactBusinessVerification(
    {
      params: { id: profile._id },
      body: { message, channel },
      user: { _id: 'd'.repeat(24), username: 'reviewadmin' }
    },
    response,
    (err) => { failure = err; }
  );
  return { failure, response };
}

async function invokeRespond(profile, body) {
  const response = fakeResponse();
  let failure = null;
  await respondToBusinessReview(
    {
      body,
      user: { _id: profile.userId, username: 'neonrift' }
    },
    response,
    (err) => { failure = err; }
  );
  return { failure, response };
}
