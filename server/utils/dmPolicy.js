/**
 * Direct-message consent rules.
 *
 * Everything in this file is pure: no database, no request objects, no clock.
 * The service passes in the relationship facts it already loaded, which keeps
 * the matrix easy to unit test and impossible to bypass from a controller by
 * forgetting an `if`.
 *
 * Two ideas drive the matrix:
 *   1. A recipient chooses what each *kind of relationship* may do.
 *   2. First contact from someone outside the trusted graph is a request, never
 *      an open inbox. Accepting is the only way to create a reply channel.
 */
const crypto = require('crypto');
const { normalizeMessageText, sanitizeLine, isHttpUrl } = require('./sanitize');

const DM_CONTEXTS = Object.freeze([
  'mutual',
  'follower',
  'following',
  'community',
  'squad',
  'business',
  'stranger'
]);

const DM_ACTIONS = Object.freeze(['inbox', 'request', 'verified', 'none']);
const DM_DIGESTS = Object.freeze(['off', 'daily', 'weekly']);
const DM_CONTEXT_TYPES = Object.freeze(['profile', 'post', 'community', 'squad']);
const DM_REPORT_REASONS = Object.freeze([
  'spam',
  'harassment',
  'hate_speech',
  'sexual_content',
  'other'
]);

const DEFAULT_POLICY = Object.freeze({
  mutual: 'inbox',
  follower: 'request',
  following: 'request',
  community: 'request',
  squad: 'request',
  business: 'request',
  stranger: 'request'
});

const DAY_MS = 24 * 60 * 60 * 1000;

const REQUEST_LIMITS = Object.freeze({
  maxLength: 300,
  maxLines: 5,
  expiryDays: 14,
  cooldownDays: 90,
  perDay: 5,
  perWeek: 20,
  perRecipientDays: 30,
  newAccountDays: 7,
  newAccountPerDay: 1
});

const MESSAGE_LIMITS = Object.freeze({
  maxLength: 2000,
  maxLines: 40
});

const BUSINESS_REQUEST_LIMITS = Object.freeze({
  maxLength: 600,
  maxLines: 10
});
const BUSINESS_INTENTS = Object.freeze([
  'collab', 'sponsorship', 'support', 'press', 'partnership', 'other'
]);
const BUSINESS_BUDGETS = Object.freeze(['under_500', '500_2000', '2000_plus']);

const MAX_HIDDEN_WORDS = 50;
const MAX_QUICK_REPLIES = 5;
const QUICK_REPLY_MAX_LENGTH = 300;
const MAX_LABELS = 8;
const LABEL_MAX_LENGTH = 24;
const CAMPAIGN_PRIOR_REQUESTS = 2;
const DM_AVAILABILITY = Object.freeze(['open', 'away', 'paused']);

// First messages are text-only. The scheme check catches explicit URLs; the
// domain check catches the usual "discord.gg/…" workaround without rejecting
// ordinary sentences ("8 p.m." has no matching TLD).
const LINK_PATTERN = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:com|net|org|io|gg|tv|co|me|app|dev|xyz|link|site|club|live)(?:\b|[/?#])/i;

function idOf(value) {
  if (!value) return '';
  return String(value._id || value.id || value);
}

function defaultDmSettings() {
  return {
    policy: { ...DEFAULT_POLICY },
    digest: 'daily',
    quietHours: { enabled: false, start: '22:00', end: '07:00', timezone: 'UTC' },
    readReceipts: false,
    hiddenWords: [],
    availability: 'open',
    awayMessage: '',
    quickReplies: [],
    savedFilters: []
  };
}

function normalizeHiddenWords(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const words = [];
  for (const entry of raw) {
    const word = sanitizeLine(String(entry), 24);
    const key = word.toLowerCase();
    if (!word || seen.has(key)) continue;
    seen.add(key);
    words.push(word);
    if (words.length >= MAX_HIDDEN_WORDS) break;
  }
  return words;
}

function normalizeClock(value, fallback) {
  const clock = String(value || '').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(clock) ? clock : fallback;
}

function normalizeTimezone(value) {
  const timezone = String(value || '').trim().slice(0, 60) || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return timezone;
  } catch {
    return 'UTC';
  }
}

function normalizeQuietHours(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: source.enabled === true,
    start: normalizeClock(source.start, '22:00'),
    end: normalizeClock(source.end, '07:00'),
    timezone: normalizeTimezone(source.timezone)
  };
}

const SAVED_FILTER_FOLDERS = Object.freeze(['inbox', 'requests', 'filtered', 'sent', 'archived']);
const SAVED_FILTER_SCOPES = Object.freeze(['all', 'personal', 'business']);
const MAX_SAVED_FILTERS = 6;

function normalizeSavedFilters(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const names = new Set();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const name = sanitizeLine(String(entry.name || ''), 24);
    const key = name.toLowerCase();
    if (!name || names.has(key)) continue;
    if (!SAVED_FILTER_FOLDERS.includes(entry.folder)) continue;
    names.add(key);
    out.push({
      name,
      folder: entry.folder,
      scope: SAVED_FILTER_SCOPES.includes(entry.scope) ? entry.scope : 'all',
      unreadOnly: entry.unreadOnly === true
    });
    if (out.length >= MAX_SAVED_FILTERS) break;
  }
  return out;
}

function normalizeQuickReplies(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const replies = [];
  for (const entry of raw) {
    const reply = sanitizeLine(String(entry), QUICK_REPLY_MAX_LENGTH);
    const key = reply.toLowerCase();
    if (!reply || seen.has(key)) continue;
    seen.add(key);
    replies.push(reply);
    if (replies.length >= MAX_QUICK_REPLIES) break;
  }
  return replies;
}

/**
 * Coerce whatever is stored (or missing, for pre-migration users) into the
 * shape the rest of the app can trust.
 */
function normalizeDmSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const policy = {};
  for (const context of DM_CONTEXTS) {
    const value = source.policy && source.policy[context];
    policy[context] = DM_ACTIONS.includes(value) ? value : DEFAULT_POLICY[context];
  }

  return {
    policy,
    digest: DM_DIGESTS.includes(source.digest) ? source.digest : 'daily',
    quietHours: normalizeQuietHours(source.quietHours),
    readReceipts: source.readReceipts === true,
    hiddenWords: normalizeHiddenWords(source.hiddenWords),
    availability: DM_AVAILABILITY.includes(source.availability) ? source.availability : 'open',
    awayMessage: sanitizeLine(String(source.awayMessage || ''), 200),
    quickReplies: normalizeQuickReplies(source.quickReplies),
    savedFilters: normalizeSavedFilters(source.savedFilters)
  };
}

/**
 * Validate a partial settings patch from the client.
 * Returns only the keys the caller actually supplied, so the controller can
 * write dot-paths without clobbering untouched rows.
 */
function sanitizeDmSettingsPatch(body) {
  const errors = [];
  const value = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: ['Invalid settings payload.'], value: {} };
  }

  if (body.policy !== undefined) {
    if (!body.policy || typeof body.policy !== 'object' || Array.isArray(body.policy)) {
      errors.push('Policy must be an object.');
    } else {
      const policy = {};
      for (const context of DM_CONTEXTS) {
        if (body.policy[context] === undefined) continue;
        if (!DM_ACTIONS.includes(body.policy[context])) {
          errors.push(`Unknown policy for ${context}.`);
          continue;
        }
        policy[context] = body.policy[context];
      }
      if (Object.keys(policy).length > 0) value.policy = policy;
    }
  }

  if (body.digest !== undefined) {
    if (!DM_DIGESTS.includes(body.digest)) errors.push('Unknown digest frequency.');
    else value.digest = body.digest;
  }

  if (body.quietHours !== undefined) {
    if (!body.quietHours || typeof body.quietHours !== 'object' || Array.isArray(body.quietHours)) {
      errors.push('quietHours must be an object.');
    } else {
      const next = {};
      if (body.quietHours.enabled !== undefined) {
        if (typeof body.quietHours.enabled !== 'boolean') errors.push('quietHours.enabled must be true or false.');
        else next.enabled = body.quietHours.enabled;
      }
      for (const key of ['start', 'end']) {
        if (body.quietHours[key] === undefined) continue;
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.quietHours[key]))) {
          errors.push(`quietHours.${key} must be HH:MM.`);
        } else {
          next[key] = body.quietHours[key];
        }
      }
      if (body.quietHours.timezone !== undefined) {
        if (typeof body.quietHours.timezone !== 'string') errors.push('quietHours.timezone must be text.');
        else next.timezone = normalizeTimezone(body.quietHours.timezone);
      }
      if (Object.keys(next).length > 0) value.quietHours = next;
    }
  }

  if (body.readReceipts !== undefined) {
    if (typeof body.readReceipts !== 'boolean') errors.push('readReceipts must be true or false.');
    else value.readReceipts = body.readReceipts;
  }

  if (body.availability !== undefined) {
    if (!DM_AVAILABILITY.includes(body.availability)) errors.push('Unknown inbox availability.');
    else value.availability = body.availability;
  }

  if (body.awayMessage !== undefined) {
    if (typeof body.awayMessage !== 'string') errors.push('awayMessage must be text.');
    else value.awayMessage = sanitizeLine(body.awayMessage, 200);
  }

  if (body.quickReplies !== undefined) {
    const raw = Array.isArray(body.quickReplies)
      ? body.quickReplies
      : typeof body.quickReplies === 'string'
        ? body.quickReplies.split('\n')
        : null;
    if (!raw) {
      errors.push('quickReplies must be a list.');
    } else if (raw.length > MAX_QUICK_REPLIES) {
      errors.push(`You can save at most ${MAX_QUICK_REPLIES} quick replies.`);
    } else {
      value.quickReplies = normalizeQuickReplies(raw);
    }
  }

  if (body.savedFilters !== undefined) {
    if (!Array.isArray(body.savedFilters)) {
      errors.push('savedFilters must be a list.');
    } else {
      value.savedFilters = normalizeSavedFilters(body.savedFilters);
    }
  }

  if (body.hiddenWords !== undefined) {
    const raw = Array.isArray(body.hiddenWords)
      ? body.hiddenWords
      : typeof body.hiddenWords === 'string'
        ? body.hiddenWords.split(',')
        : null;
    if (!raw) {
      errors.push('hiddenWords must be a list.');
    } else if (raw.length > MAX_HIDDEN_WORDS) {
      errors.push(`You can hide at most ${MAX_HIDDEN_WORDS} words.`);
    } else {
      const seen = new Set();
      const words = [];
      for (const entry of raw) {
        const word = sanitizeLine(String(entry), 24);
        const key = word.toLowerCase();
        if (!word || seen.has(key)) continue;
        seen.add(key);
        words.push(word);
      }
      value.hiddenWords = words;
    }
  }

  if (errors.length === 0 && Object.keys(value).length === 0) {
    errors.push('Nothing to update.');
  }
  return { ok: errors.length === 0, errors, value };
}

/**
 * Verified means "a Google identity with a verified email is linked". We do not
 * sell verification in Phase A; it is an attribute the account already has.
 */
function isVerifiedIdentity(user) {
  return Boolean(
    user &&
      Array.isArray(user.authIdentities) &&
      user.authIdentities.some(identity => identity.provider === 'google' && identity.emailVerified === true)
  );
}

/**
 * Relationship from the *sender's* point of view:
 *   follower  = sender follows the recipient
 *   following = recipient follows the sender
 *   mutual    = both
 */
function relationshipFor({ sender, recipient }) {
  const senderId = idOf(sender);
  const recipientId = idOf(recipient);
  const senderFollows = (sender?.following || []).some(entry => idOf(entry) === recipientId);
  const recipientFollows = (recipient?.following || []).some(entry => idOf(entry) === senderId);
  if (senderFollows && recipientFollows) return 'mutual';
  if (senderFollows) return 'follower';
  if (recipientFollows) return 'following';
  return 'stranger';
}

/**
 * Trusted graph rows win over a shared-room row. A mutual who happens to share
 * a server should not be demoted to the community policy; a stranger in a
 * server uses the community row instead of the stranger row.
 */
function policyContextFor(relationship, contextType, senderIsBusiness = false) {
  if (relationship === 'mutual' || relationship === 'follower' || relationship === 'following') {
    return relationship;
  }
  // A recipient can apply a distinct rule to disclosed business accounts even
  // when the two people share a server.
  if (senderIsBusiness) return 'business';
  if (contextType === 'community' || contextType === 'squad') return contextType;
  return 'stranger';
}

function labelForMode(mode) {
  switch (mode) {
    case 'inbox':
      return 'Open to messages';
    case 'request':
      return 'Accepts message requests';
    case 'verified':
      return 'Verified accounts only';
    case 'none':
      return 'Not accepting messages';
    default:
      return 'Accepts message requests';
  }
}

/**
 * Decide whether `sender` may start contact with `recipient`.
 *
 * `allowed` only answers "may they contact at all". `mode` says how:
 *   inbox   -> create an active thread immediately
 *   request -> create a pending request that the recipient must accept
 */
function evaluateDmPermission({
  sender,
  recipient,
  settings,
  contextType = 'profile',
  relationship,
  senderIsBusiness = false
}) {
  const senderId = idOf(sender);
  const recipientId = idOf(recipient);
  if (!senderId || !recipientId) {
    return { allowed: false, mode: 'none', code: 'DM_UNAVAILABLE', reason: 'This player is not available.' };
  }
  if (senderId === recipientId) {
    return { allowed: false, mode: 'none', code: 'DM_SELF', reason: 'You cannot message yourself.' };
  }

  const relation = relationship || relationshipFor({ sender, recipient });
  const contextKey = policyContextFor(relation, contextType, senderIsBusiness);
  const policy = normalizeDmSettings(settings).policy;
  const mode = policy[contextKey];

  if (mode === 'inbox' || mode === 'request') {
    return { allowed: true, mode, contextKey, relationship: relation };
  }

  if (mode === 'verified') {
    if (isVerifiedIdentity(sender)) {
      return { allowed: true, mode: 'request', contextKey, relationship: relation, verified: true };
    }
    return {
      allowed: false,
      mode,
      contextKey,
      relationship: relation,
      code: 'DM_VERIFIED_ONLY',
      reason: 'This player only accepts messages from verified accounts.'
    };
  }

  return {
    allowed: false,
    mode: 'none',
    contextKey,
    relationship: relation,
    code: 'DM_POLICY_NONE',
    reason: 'This player is not accepting messages.'
  };
}

/**
 * Public, non-sensitive projection used on a profile card. Never expose the
 * whole policy matrix; only the row that applies to this viewer.
 */
function describeDmPolicy({ recipient, viewer, viewerIsBusiness = false }) {
  const settings = normalizeDmSettings(recipient?.dmSettings);
  const viewerId = idOf(viewer);
  const recipientId = idOf(recipient);

  if (viewerId && viewerId === recipientId) {
    return {
      mode: 'self',
      label: 'This is you',
      relationship: 'self',
      allowed: false,
      availability: settings.availability
    };
  }

  let relationship = 'stranger';
  let mode = settings.policy.stranger;
  if (viewerId) {
    relationship = relationshipFor({ sender: viewer, recipient });
    mode = settings.policy[policyContextFor(relationship, 'profile', viewerIsBusiness)];
  }

  // Pausing closes new contact without touching active threads. The profile
  // must say so before the composer opens, not fail after the message is typed.
  if (settings.availability === 'paused') {
    return {
      mode: 'paused',
      label: 'Inbox paused',
      relationship,
      allowed: false,
      availability: 'paused',
      awayMessage: settings.awayMessage
    };
  }

  const allowed =
    mode === 'inbox' ||
    mode === 'request' ||
    (mode === 'verified' && isVerifiedIdentity(viewer));

  return {
    mode,
    label: labelForMode(mode),
    relationship,
    allowed,
    availability: settings.availability,
    awayMessage: settings.availability === 'away' ? settings.awayMessage : ''
  };
}

/**
 * First messages are deliberately constrained: plain text, no links, no media.
 * Once a request is accepted the same thread allows longer messages.
 */
/** True when `now` falls inside the recipient's local quiet window. */
function isQuietHours(settings, now = new Date()) {
  const quiet = normalizeDmSettings(settings).quietHours;
  if (!quiet.enabled) return false;

  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: quiet.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(now);
  }

  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  const current = hour * 60 + minute;
  const start = Number(quiet.start.slice(0, 2)) * 60 + Number(quiet.start.slice(3, 5));
  const end = Number(quiet.end.slice(0, 2)) * 60 + Number(quiet.end.slice(3, 5));

  if (start === end) return true;
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}

function validateRequestText(raw, limits = REQUEST_LIMITS) {
  const result = normalizeMessageText(raw, {
    message: { minLength: 1, maxLength: limits.maxLength, maxLines: limits.maxLines }
  });
  if (!result.ok) return result;

  if (LINK_PATTERN.test(result.text)) {
    return { ok: false, reason: 'Links are not allowed in a first message.' };
  }
  return result;
}

/**
 * A verified business first contact is a structured brief, not a longer cold
 * DM. The website is carried by the verified profile; if the sender supplies
 * one in the brief it must match the verified domain.
 */
function validateBusinessRequest({
  text,
  intent,
  company,
  website,
  budgetBand,
  timeline,
  business
} = {}) {
  const normalized = validateRequestText(text, BUSINESS_REQUEST_LIMITS);
  if (!normalized.ok) return normalized;

  if (!BUSINESS_INTENTS.includes(intent)) {
    return { ok: false, reason: 'Choose a business intent.' };
  }

  const safeCompany = sanitizeLine(String(company || business?.displayName || ''), 80);
  if (!safeCompany) {
    return { ok: false, reason: 'Add the company or brand name.' };
  }

  let safeWebsite = '';
  if (website) {
    if (!isHttpUrl(website) || !/^https:\/\//i.test(String(website).trim())) {
      return { ok: false, reason: 'The brief website must be a secure https URL.' };
    }
    safeWebsite = String(website).trim().slice(0, 200);
    const suppliedHost = new URL(safeWebsite).hostname.toLowerCase();
    const verifiedHost = business?.website ? new URL(business.website).hostname.toLowerCase() : '';
    if (verifiedHost && suppliedHost !== verifiedHost) {
      return { ok: false, reason: 'The brief website must match your verified business domain.' };
    }
  }

  if (budgetBand && !BUSINESS_BUDGETS.includes(budgetBand)) {
    return { ok: false, reason: 'Choose a valid budget band.' };
  }

  return {
    ok: true,
    value: {
      text: normalized.text,
      intent,
      company: safeCompany,
      website: safeWebsite,
      budgetBand: budgetBand || null,
      timeline: sanitizeLine(String(timeline || ''), 40)
    }
  };
}

function normalizeDmMessage(raw) {
  return normalizeMessageText(raw, {
    message: { minLength: 1, maxLength: MESSAGE_LIMITS.maxLength, maxLines: MESSAGE_LIMITS.maxLines }
  });
}

/**
 * Pure quota calculation, so the service can feed it counts and tests can
 * exercise every branch without a database.
 */
function quotaState({
  sentToday = 0,
  sentThisWeek = 0,
  lastRequestAt = null,
  accountCreatedAt = null,
  now = Date.now(),
  limits = {}
}) {
  const config = { ...REQUEST_LIMITS, ...limits };
  const nowMs = new Date(now).getTime();
  const createdMs = accountCreatedAt ? new Date(accountCreatedAt).getTime() : nowMs;
  const newAccount = nowMs - createdMs < config.newAccountDays * DAY_MS;
  const dailyLimit = newAccount ? config.newAccountPerDay : config.perDay;

  if (sentToday >= dailyLimit) {
    return {
      allowed: false,
      code: 'DM_QUOTA_DAY',
      reason: newAccount
        ? 'New accounts can send one message request per day.'
        : 'You have reached your daily message-request limit.'
    };
  }
  if (sentThisWeek >= config.perWeek) {
    return {
      allowed: false,
      code: 'DM_QUOTA_WEEK',
      reason: 'You have reached your weekly message-request limit.'
    };
  }
  if (lastRequestAt && nowMs - new Date(lastRequestAt).getTime() < config.perRecipientDays * DAY_MS) {
    return {
      allowed: false,
      code: 'DM_RECIPIENT_COOLDOWN',
      reason: 'You already contacted this player recently. Give them space.'
    };
  }
  return { allowed: true };
}

function cooldownActive(retryAfter, now = Date.now()) {
  return Boolean(retryAfter && new Date(retryAfter).getTime() > new Date(now).getTime());
}

/** Validate a creator's private labels without letting one label become a note. */
function sanitizeLabels(raw) {
  let entries;
  if (Array.isArray(raw)) entries = raw;
  else if (typeof raw === 'string') entries = raw.split(',');
  else return { ok: false, errors: ['Labels must be a list.'], value: [] };

  const seen = new Set();
  const value = [];
  for (const entry of entries) {
    const label = sanitizeLine(String(entry), LABEL_MAX_LENGTH);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    value.push(label);
    if (value.length > MAX_LABELS) {
      return { ok: false, errors: [`You can add at most ${MAX_LABELS} labels.`], value: [] };
    }
  }
  return { ok: true, errors: [], value };
}

/** Stable fingerprint for identical-text campaign detection, never reversible. */
function requestFingerprint(text) {
  const normalized = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/** Return the first hidden word that appears as a whole word (or phrase). */
function matchHiddenWord(text, hiddenWords = []) {
  const haystack = String(text || '').toLowerCase();
  for (const entry of Array.isArray(hiddenWords) ? hiddenWords : []) {
    const word = String(entry || '').trim().toLowerCase();
    if (!word) continue;
    if (word.includes(' ')) {
      if (haystack.includes(word)) return entry;
      continue;
    }
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, 'i');
    if (pattern.test(haystack)) return entry;
  }
  return null;
}

/** Turn abuse counters into the tier the request filter reads. */
function reputationTier({ reports = 0, blocks = 0 } = {}) {
  if (Number(reports) >= 5 || Number(blocks) >= 5) return 'restricted';
  if (Number(reports) >= 1 || Number(blocks) >= 1) return 'limited';
  return 'standard';
}

/**
 * Decide whether a pending request belongs in the Filtered lane. Hidden words
 * are an explicit recipient rule and win over inferred signals; campaign and
 * reputation are deliberately silent to the sender.
 */
function chooseRequestFilter({
  text,
  hiddenWords = [],
  reputationTier: tier = 'standard',
  campaignCount = 0
} = {}) {
  const matched = matchHiddenWord(text, hiddenWords);
  if (matched) return { reason: 'hidden_word', matched };
  if (tier === 'restricted') return { reason: 'reputation', matched: '' };
  if (Number(campaignCount) >= CAMPAIGN_PRIOR_REQUESTS) {
    return { reason: 'campaign', matched: '' };
  }
  return null;
}

module.exports = {
  DM_CONTEXTS,
  DM_ACTIONS,
  DM_DIGESTS,
  DM_CONTEXT_TYPES,
  DM_REPORT_REASONS,
  DEFAULT_POLICY,
  REQUEST_LIMITS,
  MESSAGE_LIMITS,
  MAX_HIDDEN_WORDS,
  BUSINESS_REQUEST_LIMITS,
  BUSINESS_INTENTS,
  BUSINESS_BUDGETS,
  MAX_QUICK_REPLIES,
  MAX_SAVED_FILTERS,
  SAVED_FILTER_FOLDERS,
  SAVED_FILTER_SCOPES,
  normalizeSavedFilters,
  QUICK_REPLY_MAX_LENGTH,
  MAX_LABELS,
  LABEL_MAX_LENGTH,
  CAMPAIGN_PRIOR_REQUESTS,
  DM_AVAILABILITY,
  DAY_MS,
  idOf,
  defaultDmSettings,
  normalizeDmSettings,
  normalizeQuietHours,
  isQuietHours,
  sanitizeDmSettingsPatch,
  sanitizeLabels,
  requestFingerprint,
  matchHiddenWord,
  reputationTier,
  chooseRequestFilter,
  isVerifiedIdentity,
  relationshipFor,
  policyContextFor,
  labelForMode,
  evaluateDmPermission,
  describeDmPolicy,
  validateRequestText,
  validateBusinessRequest,
  normalizeDmMessage,
  quotaState,
  cooldownActive
};
