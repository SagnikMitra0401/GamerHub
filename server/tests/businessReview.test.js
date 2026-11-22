const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeBusinessProfile,
  publicBusinessProfile,
  ownerBusinessProfile,
  manualReviewReadiness
} = require('../utils/business');

const base = {
  displayName: 'Neon Rift Studio',
  website: 'https://studio.example',
  supportEmail: 'hello@studio.example'
};

test('business evidence fields are sanitized and normalized', () => {
  const result = sanitizeBusinessProfile({
    ...base,
    contactEmail: 'Owner@Studio.Example',
    contactMethod: 'phone',
    contactDetail: '+1 555 0100',
    proofType: 'registration',
    proofUrl: 'https://registry.example/company/123',
    proofNote: 'Company registration entry.'
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.contactEmail, 'owner@studio.example');
  assert.equal(result.value.contactMethod, 'phone');
  assert.equal(result.value.proofType, 'registration');
  assert.equal(result.value.proofUrl, 'https://registry.example/company/123');
});

test('proof and contact values cannot smuggle unsafe links or unknown enums', () => {
  const result = sanitizeBusinessProfile({
    ...base,
    contactMethod: 'carrier-pigeon',
    proofType: 'vibes',
    proofUrl: 'javascript:alert(1)'
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /https/i);
});

test('manual review needs a reachable contact and real evidence', () => {
  assert.equal(manualReviewReadiness({}).ok, false);

  const noEvidence = manualReviewReadiness({
    supportEmail: 'hello@studio.example'
  });
  assert.equal(noEvidence.ok, false);
  assert.match(noEvidence.reason, /proof/i);

  const phoneWithoutDetail = manualReviewReadiness({
    contactMethod: 'phone',
    proofNote: 'Registered in the company registry.'
  });
  assert.equal(phoneWithoutDetail.ok, false);
  assert.match(phoneWithoutDetail.reason, /contact method/i);

  const valid = manualReviewReadiness({
    contactEmail: 'owner@studio.example',
    contactMethod: 'email',
    proofNote: 'Registered in the company registry.'
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.contactEmail, 'owner@studio.example');
});

test('public business projection never exposes private review data', () => {
  const profile = {
    ...base,
    contactEmail: 'owner@studio.example',
    contactDetail: '+1 555 0100',
    proofUrl: 'https://registry.example/company/123',
    proofNote: 'Registration entry.',
    reviewContactedAt: new Date(),
    demotionReason: 'Internal note',
    verificationStatus: 'pending',
    verificationToken: 'secret-token'
  };

  const publicCard = publicBusinessProfile(profile);
  assert.equal('contactEmail' in publicCard, false);
  assert.equal('contactDetail' in publicCard, false);
  assert.equal('proofUrl' in publicCard, false);
  assert.equal('proofNote' in publicCard, false);
  assert.equal('reviewContactedAt' in publicCard, false);
  assert.equal('verificationToken' in publicCard, false);

  const ownerView = ownerBusinessProfile(profile);
  assert.equal(ownerView.contactEmail, 'owner@studio.example');
  assert.equal(ownerView.proofUrl, 'https://registry.example/company/123');
  assert.equal(ownerView.verificationToken, 'secret-token');
});
