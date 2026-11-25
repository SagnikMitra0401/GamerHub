const { sanitizeLine, sanitizeText, isHttpUrl } = require('./sanitize');

const BUSINESS_CATEGORIES = Object.freeze(['creator', 'esports', 'studio', 'brand', 'other']);
const BUSINESS_VERIFICATION_METHODS = Object.freeze(['dns', 'manual']);
const BUSINESS_CONTACT_METHODS = Object.freeze(['email', 'phone', 'other']);
const BUSINESS_PROOF_TYPES = Object.freeze([
  'registration',
  'tax',
  'domain_email',
  'official_profile',
  'other',
]);

/**
 * Fairness window between contacting a business and being allowed to take the
 * business role away. Seven days is the documented target; it is fixed here so
 * the API, the admin queue and the tests cannot drift apart.
 */
const BUSINESS_REVIEW_RESPONSE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

function httpsUrl(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (!isHttpUrl(raw) || !/^https:\/\//i.test(raw)) return '';
  return raw.slice(0, 200);
}

function email(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw.slice(0, 120) : '';
}

/**
 * Validate the owner-editable half of a business profile. Verification fields
 * are intentionally not accepted from this payload.
 */
function sanitizeBusinessProfile(input = {}) {
  const displayName = sanitizeLine(String(input.displayName || ''), 80);
  if (displayName.length < 2) {
    return { ok: false, reason: 'Add a business display name of at least 2 characters.' };
  }

  const category = BUSINESS_CATEGORIES.includes(input.category) ? input.category : 'creator';
  const website = httpsUrl(input.website);
  if (input.website && !website) {
    return { ok: false, reason: 'The business website must be a secure https URL.' };
  }

  const supportEmail = email(input.supportEmail);
  if (input.supportEmail && !supportEmail) {
    return { ok: false, reason: 'Enter a valid support email address.' };
  }

  const contactEmail = email(input.contactEmail);
  if (input.contactEmail && !contactEmail) {
    return { ok: false, reason: 'Enter a valid official contact email address.' };
  }

  const contactMethod = BUSINESS_CONTACT_METHODS.includes(input.contactMethod)
    ? input.contactMethod
    : 'email';
  const contactDetail = sanitizeLine(String(input.contactDetail || ''), 120);
  if (contactMethod !== 'email' && input.contactDetail && !contactDetail) {
    return { ok: false, reason: 'Describe how the reviewer should reach the business.' };
  }

  const proofType = BUSINESS_PROOF_TYPES.includes(input.proofType) ? input.proofType : 'other';
  const proofUrl = httpsUrl(input.proofUrl);
  if (input.proofUrl && !proofUrl) {
    return { ok: false, reason: 'The proof link must be a secure https URL.' };
  }

  const rawLinks = Array.isArray(input.links) ? input.links : [];
  const links = [];
  for (const entry of rawLinks.slice(0, 10)) {
    const link = httpsUrl(entry);
    if (!link) continue;
    if (!links.includes(link)) links.push(link);
    if (links.length >= 5) break;
  }

  return {
    ok: true,
    value: {
      displayName,
      category,
      description: sanitizeLine(String(input.description || ''), 600),
      website,
      supportEmail,
      contactEmail,
      contactMethod,
      contactDetail,
      proofType,
      proofUrl,
      proofNote: sanitizeLine(String(input.proofNote || ''), 600),
      timezone: sanitizeLine(String(input.timezone || ''), 60),
      responseExpectation: sanitizeLine(String(input.responseExpectation || ''), 80),
      links,
    },
  };
}

/** Public business fields. Never includes tokens, reviewer ids or counters. */
function publicBusinessProfile(profile) {
  if (!profile) return null;
  return {
    displayName: profile.displayName || '',
    category: profile.category || 'creator',
    description: profile.description || '',
    website: profile.website || '',
    supportEmail: profile.supportEmail || '',
    timezone: profile.timezone || '',
    responseExpectation: profile.responseExpectation || '',
    links: Array.isArray(profile.links) ? profile.links.slice(0, 5) : [],
    verificationStatus: profile.verificationStatus || 'none',
    verifiedAt: profile.verifiedAt || null,
    outreachPaused: Boolean(profile.outreachPaused),
    createdAt: profile.createdAt || null,
  };
}

/** When the business's chance to answer the current review request ends. */
function reviewWindowEndsAt(profile) {
  const contactedAt = toDate(profile?.reviewContactedAt);
  if (!contactedAt) return null;
  return new Date(contactedAt.getTime() + BUSINESS_REVIEW_RESPONSE_DAYS * DAY_MS);
}

/**
 * Owner/reviewer view: the public card plus fields that must never appear in a
 * public profile projection (verification correspondence and evidence).
 */
function ownerBusinessProfile(profile) {
  if (!profile) return null;
  return {
    ...publicBusinessProfile(profile),
    contactEmail: profile.contactEmail || '',
    contactMethod: profile.contactMethod || 'email',
    contactDetail: profile.contactDetail || '',
    proofType: profile.proofType || 'other',
    proofUrl: profile.proofUrl || '',
    proofNote: profile.proofNote || '',
    verificationMethod: profile.verificationMethod || null,
    verificationDomain: profile.verificationDomain || '',
    verificationToken: profile.verificationToken || '',
    verificationRequestedAt: profile.verificationRequestedAt || null,
    reviewContactedAt: profile.reviewContactedAt || null,
    reviewRespondedAt: profile.reviewRespondedAt || null,
    reviewResponseNote: profile.reviewResponseNote || '',
    reviewResponseDueAt: reviewWindowEndsAt(profile),
    reviewDecidedAt: profile.reviewDecidedAt || null,
    evidencePurgedAt: profile.evidencePurgedAt || null,
    demotedAt: profile.demotedAt || null,
    demotionReason: profile.demotionReason || '',
  };
}

/**
 * A manual review needs a working correspondence route and some evidence a
 * reviewer can check. Keeping this pure lets the API and tests share it.
 */
function manualReviewReadiness(profile = {}) {
  const contactEmail = email(profile.contactEmail || profile.supportEmail);
  const contactMethod = BUSINESS_CONTACT_METHODS.includes(profile.contactMethod)
    ? profile.contactMethod
    : 'email';
  if (contactMethod === 'email' && !contactEmail) {
    return {
      ok: false,
      reason: 'Add an official contact email before requesting manual review.',
    };
  }
  if (contactMethod !== 'email' && !String(profile.contactDetail || '').trim()) {
    return {
      ok: false,
      reason: 'Describe the phone number or other contact method before requesting manual review.',
    };
  }
  if (!profile.proofUrl && !String(profile.proofNote || '').trim()) {
    return {
      ok: false,
      reason: 'Add a proof link or a short note describing your business evidence.',
    };
  }
  return { ok: true, contactEmail, contactMethod };
}

/**
 * Validate the owner's answer to a review contact. A response is stored so the
 * reviewer sees it next to the evidence it is meant to explain.
 */
function sanitizeReviewResponse(input = {}) {
  const note = sanitizeText(String(input.note || input.response || ''), 1000);
  if (note.length < 10) {
    return { ok: false, reason: 'Write at least 10 characters explaining your side.' };
  }
  return { ok: true, value: note };
}

/**
 * A demotion is allowed only once a reviewer has contacted the business about
 * THIS review request and the business has had the whole response window to
 * answer. Pure so the endpoint, the admin queue and the tests share one rule.
 */
function demotionReadiness(profile = {}, now = new Date()) {
  const current = toDate(now) || new Date();
  const contactedAt = toDate(profile.reviewContactedAt);
  const requestedAt = toDate(profile.verificationRequestedAt);

  if (!contactedAt) {
    return {
      ok: false,
      code: 'BUSINESS_CONTACT_REQUIRED',
      reason: 'Contact the business official before demoting this account.',
    };
  }

  if (requestedAt && contactedAt.getTime() < requestedAt.getTime()) {
    return {
      ok: false,
      code: 'BUSINESS_CONTACT_STALE',
      reason:
        'The last contact predates this review request. Contact the business again before demoting.',
    };
  }

  const earliestDemotionAt = reviewWindowEndsAt({ reviewContactedAt: contactedAt });
  if (current.getTime() < earliestDemotionAt.getTime()) {
    const daysRemaining = Math.ceil((earliestDemotionAt.getTime() - current.getTime()) / DAY_MS);
    return {
      ok: false,
      code: 'BUSINESS_RESPONSE_WINDOW',
      reason: `The business has until ${earliestDemotionAt.toUTCString()} to respond (${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left).`,
      contactedAt,
      earliestDemotionAt,
      daysRemaining,
    };
  }

  return { ok: true, contactedAt, earliestDemotionAt, daysRemaining: 0 };
}

function verificationDomainFor(profile) {
  if (profile?.website) {
    try {
      return new URL(profile.website).hostname.toLowerCase();
    } catch {
      return '';
    }
  }
  return '';
}

module.exports = {
  BUSINESS_CATEGORIES,
  BUSINESS_VERIFICATION_METHODS,
  BUSINESS_CONTACT_METHODS,
  BUSINESS_PROOF_TYPES,
  BUSINESS_REVIEW_RESPONSE_DAYS,
  sanitizeBusinessProfile,
  publicBusinessProfile,
  ownerBusinessProfile,
  manualReviewReadiness,
  sanitizeReviewResponse,
  demotionReadiness,
  reviewWindowEndsAt,
  verificationDomainFor,
};
