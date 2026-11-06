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
const { normalizeMessageText, sanitizeLine } = require('./sanitize');

const DM_CONTEXTS = Object.freeze([
  'mutual',
  'follower',
  'following',
  'community',
  'squad',
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

const MAX_HIDDEN_WORDS = 50;

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
    readReceipts: false,
    hiddenWords: []
  };
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
    readReceipts: source.readReceipts === true,
    hiddenWords: Array.isArray(source.hiddenWords)
      ? (() => {
          const seen = new Set();
          const words = [];
          for (const entry of source.hiddenWords) {
            const word = sanitizeLine(String(entry), 24);
            const key = word.toLowerCase();
            if (!word || seen.has(key)) continue;
            seen.add(key);
            words.push(word);
            if (words.length >= MAX_HIDDEN_WORDS) break;
          }
          return words;
        })()
      : []
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

  if (body.readReceipts !== undefined) {
    if (typeof body.readReceipts !== 'boolean') errors.push('readReceipts must be true or false.');
    else value.readReceipts = body.readReceipts;
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
function policyContextFor(relationship, contextType) {
  if (relationship === 'mutual' || relationship === 'follower' || relationship === 'following') {
    return relationship;
  }
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
  relationship
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
  const contextKey = policyContextFor(relation, contextType);
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
function describeDmPolicy({ recipient, viewer }) {
  const settings = normalizeDmSettings(recipient?.dmSettings);
  const viewerId = idOf(viewer);
  const recipientId = idOf(recipient);

  if (viewerId && viewerId === recipientId) {
    return { mode: 'self', label: 'This is you', relationship: 'self', allowed: false };
  }

  let relationship = 'stranger';
  let mode = settings.policy.stranger;
  if (viewerId) {
    relationship = relationshipFor({ sender: viewer, recipient });
    mode = settings.policy[policyContextFor(relationship, 'profile')];
  }

  const allowed =
    mode === 'inbox' ||
    mode === 'request' ||
    (mode === 'verified' && isVerifiedIdentity(viewer));

  return {
    mode,
    label: labelForMode(mode),
    relationship,
    allowed
  };
}

/**
 * First messages are deliberately constrained: plain text, no links, no media.
 * Once a request is accepted the same thread allows longer messages.
 */
function validateRequestText(raw) {
  const result = normalizeMessageText(raw, {
    message: { minLength: 1, maxLength: REQUEST_LIMITS.maxLength, maxLines: REQUEST_LIMITS.maxLines }
  });
  if (!result.ok) return result;

  if (LINK_PATTERN.test(result.text)) {
    return { ok: false, reason: 'Links are not allowed in a first message.' };
  }
  return result;
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
  DAY_MS,
  idOf,
  defaultDmSettings,
  normalizeDmSettings,
  sanitizeDmSettingsPatch,
  isVerifiedIdentity,
  relationshipFor,
  policyContextFor,
  labelForMode,
  evaluateDmPermission,
  describeDmPolicy,
  validateRequestText,
  normalizeDmMessage,
  quotaState,
  cooldownActive
};
