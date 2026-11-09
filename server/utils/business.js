const { sanitizeLine, isHttpUrl } = require('./sanitize');

const BUSINESS_CATEGORIES = Object.freeze(['creator', 'esports', 'studio', 'brand', 'other']);
const BUSINESS_VERIFICATION_METHODS = Object.freeze(['dns', 'manual']);

function httpsUrl(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (!isHttpUrl(raw) || !/^https:\/\//i.test(raw)) return '';
  return raw.slice(0, 200);
}

function email(value) {
  const raw = String(value || '').trim().toLowerCase();
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
      timezone: sanitizeLine(String(input.timezone || ''), 60),
      responseExpectation: sanitizeLine(String(input.responseExpectation || ''), 80),
      links
    }
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
    createdAt: profile.createdAt || null
  };
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
  sanitizeBusinessProfile,
  publicBusinessProfile,
  verificationDomainFor
};
