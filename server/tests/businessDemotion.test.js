const test = require('node:test');
const assert = require('node:assert/strict');

// Stub side-effectful collaborators before the controller captures them in its
// module scope, so this suite never touches MongoDB, the email bridge or Sentry.
const audit = require('../utils/audit');
const email = require('../utils/email');
const originalAudit = audit.recordPlatformAudit;
const originalReviewEmail = email.sendBusinessReviewEmail;
audit.recordPlatformAudit = async () => null;
email.sendBusinessReviewEmail = async () => ({ id: 'test' });

const BusinessProfile = require('../models/BusinessProfile');
const BusinessTeamMember = require('../models/BusinessTeamMember');
const BusinessVerificationAudit = require('../models/BusinessVerificationAudit');
const User = require('../models/User');

const {
  BUSINESS_REVIEW_RESPONSE_DAYS,
  demotionReadiness,
  sanitizeReviewResponse,
  ownerBusinessProfile
} = require('../utils/business');
const { demoteBusinessAccount } = require('../controllers/businessController');

const DAY = 24 * 60 * 60 * 1000;
// The controller calls demotionReadiness without a clock, so its window is
// measured against the real one. Fixtures therefore share that instant: a fixed
// calendar date made "contacted five days ago" read as inside the window on the
// day the file was written and as outside it a week later.
const NOW = new Date();
const ago = (days) => new Date(NOW.getTime() - days * DAY);

const originals = {
  findById: BusinessProfile.findById,
  teamUpdateMany: BusinessTeamMember.updateMany,
  auditCreate: BusinessVerificationAudit.create,
  userFindById: User.findById,
  userUpdateOne: User.updateOne
};

test.after(() => {
  // Leave the shared mongoose models and modules as they were for other suites.
  BusinessProfile.findById = originals.findById;
  BusinessTeamMember.updateMany = originals.teamUpdateMany;
  BusinessVerificationAudit.create = originals.auditCreate;
  User.findById = originals.userFindById;
  User.updateOne = originals.userUpdateOne;
  audit.recordPlatformAudit = originalAudit;
  email.sendBusinessReviewEmail = originalReviewEmail;
});

test('demotion is blocked when the business was never contacted', async () => {
  const profile = fakeProfile({
    verificationRequestedAt: ago(2),
    reviewContactedAt: null
  });

  const result = await invokeDemote(profile);

  assert.equal(result.failure?.statusCode, 409);
  assert.equal(result.failure?.code, 'BUSINESS_CONTACT_REQUIRED');
  assert.match(result.failure.message, /contact/i);
  assert.equal(profile.saves, 0, 'a blocked demotion must not write the profile');
  assert.equal(profile.verificationStatus, 'pending');
  assert.equal(profile.demotedAt, null);
});

test('a contact from before the current review request does not authorise demotion', async () => {
  const profile = fakeProfile({
    verificationRequestedAt: ago(1),
    // The reviewer spoke to them about an older application, not this one.
    reviewContactedAt: ago(20)
  });

  const result = await invokeDemote(profile);

  assert.equal(result.failure?.statusCode, 409);
  assert.equal(result.failure?.code, 'BUSINESS_CONTACT_STALE');
  assert.equal(profile.saves, 0);
});

test('demotion waits out the response window after contact', async () => {
  const profile = fakeProfile({
    verificationRequestedAt: ago(3),
    reviewContactedAt: ago(1)
  });

  const readiness = demotionReadiness(profile, NOW);
  assert.equal(readiness.ok, false);
  assert.equal(readiness.code, 'BUSINESS_RESPONSE_WINDOW');
  assert.equal(readiness.daysRemaining, BUSINESS_REVIEW_RESPONSE_DAYS - 1);
  assert.equal(
    readiness.earliestDemotionAt.getTime(),
    profile.reviewContactedAt.getTime() + BUSINESS_REVIEW_RESPONSE_DAYS * DAY
  );

  const result = await invokeDemote(profile);
  assert.equal(result.failure?.statusCode, 409);
  assert.equal(result.failure?.code, 'BUSINESS_RESPONSE_WINDOW');
  assert.equal(profile.saves, 0);
});

test('an owner response does not shortcut the fairness window', async () => {
  const profile = fakeProfile({
    verificationRequestedAt: ago(6),
    reviewContactedAt: ago(5),
    reviewRespondedAt: ago(4),
    reviewResponseNote: 'The registry entry was updated; here is the public filing.'
  });

  const result = await invokeDemote(profile);

  assert.equal(result.failure?.statusCode, 409);
  assert.equal(result.failure?.code, 'BUSINESS_RESPONSE_WINDOW');
  assert.equal(profile.saves, 0);
});

test('demotion is allowed only after the window has fully elapsed', async () => {
  const profile = fakeProfile({
    verificationRequestedAt: ago(9),
    reviewContactedAt: ago(BUSINESS_REVIEW_RESPONSE_DAYS)
  });

  const atBoundary = demotionReadiness(profile, NOW);
  assert.equal(atBoundary.ok, true);
  assert.equal(atBoundary.daysRemaining, 0);

  profile.reviewContactedAt = new Date(NOW.getTime() - BUSINESS_REVIEW_RESPONSE_DAYS * DAY + 1);
  assert.equal(demotionReadiness(profile, NOW).code, 'BUSINESS_RESPONSE_WINDOW');

  profile.reviewContactedAt = ago(BUSINESS_REVIEW_RESPONSE_DAYS + 1);
  const result = await invokeDemote(profile);

  assert.equal(result.failure, null, result.failure?.message);
  assert.equal(result.response.payload?.demoted, true);
  assert.equal(profile.verificationStatus, 'none');
  assert.equal(profile.verificationToken, '');
  assert.ok(profile.demotedAt instanceof Date);
});

test('a contact without a request timestamp still waits out the window', () => {
  // Legacy rows may predate verificationRequestedAt; a logged contact is still
  // enough on its own, but the window still applies.
  const noRequest = demotionReadiness({ reviewContactedAt: ago(8) }, NOW);
  assert.equal(noRequest.ok, true);

  const contactedToday = demotionReadiness({ reviewContactedAt: NOW }, NOW);
  assert.equal(contactedToday.ok, false);
  assert.equal(contactedToday.code, 'BUSINESS_RESPONSE_WINDOW');
});

test('review responses are trimmed, bounded and at least ten characters', () => {
  assert.equal(sanitizeReviewResponse({ note: 'too short' }).ok, false);
  assert.equal(sanitizeReviewResponse({ note: '          ' }).ok, false);

  const ok = sanitizeReviewResponse({
    note: '  The filing is public and lists our registered director.  '
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.value, 'The filing is public and lists our registered director.');

  const long = sanitizeReviewResponse({ note: 'x'.repeat(1200) });
  assert.equal(long.ok, true);
  assert.equal(long.value.length, 1000);
});

test('the owner projection exposes the deadline but never the contact log', () => {
  const view = ownerBusinessProfile({
    displayName: 'Neon Rift Studio',
    contactEmail: 'owner@studio.example',
    reviewContactedAt: NOW,
    reviewRespondedAt: null,
    reviewResponseNote: ''
  });

  assert.equal(
    view.reviewResponseDueAt.getTime(),
    NOW.getTime() + BUSINESS_REVIEW_RESPONSE_DAYS * DAY
  );
  assert.equal(view.reviewRespondedAt, null);
});

// ── helpers ────────────────────────────────────────────────────────────────

function fakeProfile(overrides = {}) {
  return {
    _id: 'b'.repeat(24),
    userId: 'c'.repeat(24),
    displayName: 'Neon Rift Studio',
    contactEmail: 'owner@studio.example',
    supportEmail: '',
    contactMethod: 'email',
    verificationStatus: 'pending',
    verificationMethod: 'manual',
    verificationDomain: '',
    verificationToken: 'token',
    verificationRequestedAt: null,
    reviewContactedAt: null,
    reviewRespondedAt: null,
    reviewResponseNote: '',
    demotedAt: null,
    demotionReason: '',
    verifiedAt: null,
    verifiedBy: null,
    outreachPaused: false,
    saves: 0,
    ...overrides,
    async save() {
      this.saves += 1;
      return this;
    }
  };
}

async function invokeDemote(profile) {
  BusinessProfile.findById = async () => profile;
  User.findById = () => ({
    select: () => ({
      lean: async () => ({ username: 'neonrift', email: 'owner@studio.example' })
    })
  });
  User.updateOne = async () => ({ modifiedCount: 1 });
  BusinessTeamMember.updateMany = async () => ({ modifiedCount: 2 });
  BusinessVerificationAudit.create = async () => ({});

  const response = {
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };

  let failure = null;
  await demoteBusinessAccount(
    {
      params: { id: profile._id },
      body: { reason: 'Registration details could not be confirmed.' },
      user: { _id: 'd'.repeat(24) }
    },
    response,
    (err) => { failure = err; }
  );

  return { failure, response };
}
