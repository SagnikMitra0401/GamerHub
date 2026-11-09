const test = require('node:test');
const assert = require('node:assert/strict');

const {
  defaultDmSettings,
  normalizeDmSettings,
  normalizeQuietHours,
  isQuietHours,
  sanitizeDmSettingsPatch,
  evaluateDmPermission,
  describeDmPolicy,
  validateRequestText,
  validateBusinessRequest,
  quotaState,
  isVerifiedIdentity,
  relationshipFor,
  sanitizeLabels,
  matchHiddenWord,
  requestFingerprint,
  chooseRequestFilter,
  reputationTier,
  REQUEST_LIMITS,
  MAX_LABELS,
  MAX_QUICK_REPLIES
} = require('../utils/dmPolicy');

const user = (id, extra = {}) => ({
  _id: id,
  username: id,
  following: [],
  blockedUsers: [],
  authIdentities: [],
  ...extra
});

const settingsWith = (policy) => ({
  ...defaultDmSettings(),
  policy: { ...defaultDmSettings().policy, ...policy }
});

test('defaults are mutual inbox and request for everyone else', () => {
  const settings = defaultDmSettings();
  assert.equal(settings.policy.mutual, 'inbox');
  assert.equal(settings.policy.stranger, 'request');
  assert.equal(settings.digest, 'daily');
  assert.equal(settings.availability, 'open');
  assert.deepEqual(settings.quickReplies, []);
});

test('normalizeDmSettings repairs missing and unknown values', () => {
  const settings = normalizeDmSettings({
    policy: { mutual: 'everyone', stranger: 'none' },
    digest: 'hourly',
    hiddenWords: ['  spam  ', 'SPAM', '']
  });
  assert.equal(settings.policy.mutual, 'inbox');
  assert.equal(settings.policy.stranger, 'none');
  assert.equal(settings.digest, 'daily');
  assert.deepEqual(settings.hiddenWords, ['spam']);
});

test('saved filters are bounded, deduplicated and validated', () => {
  const normalized = normalizeDmSettings({
    savedFilters: [
      { name: 'Business', folder: 'requests', scope: 'business' },
      { name: 'business', folder: 'inbox' },
      { name: 'Bad folder', folder: 'trash' },
      { name: 'Unread', folder: 'inbox', unreadOnly: true }
    ]
  });
  assert.deepEqual(normalized.savedFilters, [
    { name: 'Business', folder: 'requests', scope: 'business', unreadOnly: false },
    { name: 'Unread', folder: 'inbox', scope: 'all', unreadOnly: true }
  ]);
});

test('quiet hours handle an overnight window in UTC', () => {
  const settings = settingsWith({});
  settings.quietHours = { enabled: true, start: '22:00', end: '07:00', timezone: 'UTC' };
  assert.equal(isQuietHours(settings, new Date('2026-11-07T23:30:00Z')), true);
  assert.equal(isQuietHours(settings, new Date('2026-11-07T12:00:00Z')), false);
});

test('quiet hours respect the configured timezone', () => {
  const settings = settingsWith({});
  settings.quietHours = { enabled: true, start: '22:00', end: '07:00', timezone: 'America/New_York' };
  assert.equal(isQuietHours(settings, new Date('2026-11-07T02:30:00Z')), false);
  assert.equal(isQuietHours(settings, new Date('2026-11-07T03:30:00Z')), true);
});

 test('quiet hours normalize invalid clocks and timezones', () => {
  const normalized = normalizeQuietHours({ enabled: true, start: '25:90', end: '7:00', timezone: 'Not/AZone' });
  assert.deepEqual(normalized, { enabled: true, start: '22:00', end: '07:00', timezone: 'UTC' });
});

test('relationshipFor sees follows in both directions', () => {
  const alice = user('alice', { following: ['bob'] });
  const bob = user('bob', { following: ['alice'] });
  assert.equal(relationshipFor({ sender: alice, recipient: bob }), 'mutual');

  const carol = user('carol');
  const dave = user('dave', { following: ['carol'] });
  // Recipient follows sender: the sender lands in the recipient's "people I follow" row.
  assert.equal(relationshipFor({ sender: carol, recipient: dave }), 'following');
  assert.equal(relationshipFor({ sender: dave, recipient: carol }), 'follower');
});

test('a mutual with inbox policy may open a thread directly', () => {
  const decision = evaluateDmPermission({
    sender: user('alice', { following: ['bob'] }),
    recipient: user('bob', { following: ['alice'] }),
    settings: settingsWith({ mutual: 'inbox' })
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.mode, 'inbox');
  assert.equal(decision.contextKey, 'mutual');
});

test('a stranger is held to a request, never a direct thread', () => {
  const decision = evaluateDmPermission({
    sender: user('alice'),
    recipient: user('bob'),
    settings: settingsWith({ stranger: 'request' })
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.mode, 'request');
});

test('stranger policy none is a firewall', () => {
  const decision = evaluateDmPermission({
    sender: user('alice'),
    recipient: user('bob'),
    settings: settingsWith({ stranger: 'none' })
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'DM_POLICY_NONE');
});

test('verified-only blocks an unverified sender and requests from a verified one', () => {
  const recipient = user('bob', { dmSettings: settingsWith({ stranger: 'verified' }) });
  const unverified = evaluateDmPermission({
    sender: user('alice'),
    recipient,
    settings: recipient.dmSettings
  });
  assert.equal(unverified.allowed, false);
  assert.equal(unverified.code, 'DM_VERIFIED_ONLY');

  const verified = evaluateDmPermission({
    sender: user('alice', { authIdentities: [{ provider: 'google', emailVerified: true }] }),
    recipient,
    settings: recipient.dmSettings
  });
  assert.equal(verified.allowed, true);
  assert.equal(verified.mode, 'request');
});

test('verified identity requires a verified Google email', () => {
  assert.equal(isVerifiedIdentity(user('a')), false);
  assert.equal(
    isVerifiedIdentity(user('a', { authIdentities: [{ provider: 'google', emailVerified: false }] })),
    false
  );
  assert.equal(
    isVerifiedIdentity(user('a', { authIdentities: [{ provider: 'google', emailVerified: true }] })),
    true
  );
});

test('a shared community uses the community row for strangers', () => {
  const decision = evaluateDmPermission({
    sender: user('alice'),
    recipient: user('bob'),
    settings: settingsWith({ community: 'inbox', stranger: 'none' }),
    contextType: 'community'
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.contextKey, 'community');
});

test('a trusted relationship is not demoted by a shared-room row', () => {
  const decision = evaluateDmPermission({
    sender: user('alice', { following: ['bob'] }),
    recipient: user('bob', { following: ['alice'] }),
    settings: settingsWith({ mutual: 'inbox', community: 'none' }),
    contextType: 'community'
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.contextKey, 'mutual');
});

test('self-messaging is rejected before any policy lookup', () => {
  const me = user('alice');
  const decision = evaluateDmPermission({
    sender: me,
    recipient: me,
    settings: defaultDmSettings()
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'DM_SELF');
});

test('describeDmPolicy only exposes the viewer row', () => {
  const recipient = user('bob', {
    dmSettings: settingsWith({ mutual: 'inbox', stranger: 'none', community: 'inbox' })
  });
  const summary = describeDmPolicy({ recipient, viewer: user('alice') });
  assert.equal(summary.relationship, 'stranger');
  assert.equal(summary.mode, 'none');
  assert.equal(summary.allowed, false);

  const anonymous = describeDmPolicy({ recipient, viewer: null });
  assert.equal(anonymous.mode, 'none');
});

test('sanitizeDmSettingsPatch accepts a partial matrix and rejects unknown actions', () => {
  const good = sanitizeDmSettingsPatch({ policy: { stranger: 'none' } });
  assert.equal(good.ok, true);
  assert.deepEqual(good.value.policy, { stranger: 'none' });

  const bad = sanitizeDmSettingsPatch({ policy: { stranger: 'everyone' } });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /Unknown policy/);
});

test('sanitizeDmSettingsPatch caps and de-duplicates hidden words', () => {
  const words = Array.from({ length: 60 }, (_, index) => `Word${index}`);
  const result = sanitizeDmSettingsPatch({ hiddenWords: words });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /at most/);

  const duplicate = sanitizeDmSettingsPatch({ hiddenWords: ['spam', 'SPAM', ' eggs '] });
  assert.equal(duplicate.ok, true);
  assert.deepEqual(duplicate.value.hiddenWords, ['spam', 'eggs']);
});

test('availability and quick replies are validated and capped', () => {
  const paused = sanitizeDmSettingsPatch({ availability: 'paused', awayMessage: '  Back Monday  ' });
  assert.equal(paused.ok, true);
  assert.equal(paused.value.availability, 'paused');
  assert.equal(paused.value.awayMessage, 'Back Monday');

  const bad = sanitizeDmSettingsPatch({ availability: 'closed' });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /availability/i);

  const replies = sanitizeDmSettingsPatch({
    quickReplies: [' Thanks! ', 'THANKS!', 'Second reply']
  });
  assert.equal(replies.ok, true);
  assert.deepEqual(replies.value.quickReplies, ['Thanks!', 'Second reply']);

  const tooMany = sanitizeDmSettingsPatch({
    quickReplies: Array.from({ length: MAX_QUICK_REPLIES + 1 }, (_, index) => `Reply ${index}`)
  });
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.errors[0], /at most/);
});

test('hidden words match whole words and phrases, not fragments', () => {
  assert.equal(matchHiddenWord('Buy CRYPTO now', ['crypto']), 'crypto');
  assert.equal(matchHiddenWord('cryptocurrency is wild', ['crypto']), null);
  assert.equal(matchHiddenWord('a free v bucks offer', ['free v bucks']), 'free v bucks');
  assert.equal(matchHiddenWord('nothing here', []), null);
});

test('request fingerprints are stable across case and whitespace', () => {
  assert.equal(requestFingerprint('Hello   WORLD'), requestFingerprint('hello world'));
  assert.notEqual(requestFingerprint('hello world'), requestFingerprint('hello there'));
  assert.equal(requestFingerprint('x').length, 64);
});

test('the request filter applies hidden words before inferred signals', () => {
  assert.deepEqual(
    chooseRequestFilter({ text: 'buy crypto', hiddenWords: ['crypto'], campaignCount: 99, reputationTier: 'restricted' }),
    { reason: 'hidden_word', matched: 'crypto' }
  );
  assert.deepEqual(
    chooseRequestFilter({ text: 'hello', reputationTier: 'restricted' }),
    { reason: 'reputation', matched: '' }
  );
  assert.deepEqual(
    chooseRequestFilter({ text: 'hello', campaignCount: 2 }),
    { reason: 'campaign', matched: '' }
  );
  assert.equal(chooseRequestFilter({ text: 'hello', campaignCount: 1 }), null);
});

test('reputation tiers escalate on reports and blocks', () => {
  assert.equal(reputationTier({ reports: 0, blocks: 0 }), 'standard');
  assert.equal(reputationTier({ reports: 1, blocks: 0 }), 'limited');
  assert.equal(reputationTier({ reports: 5, blocks: 0 }), 'restricted');
  assert.equal(reputationTier({ reports: 0, blocks: 5 }), 'restricted');
});

test('labels are deduplicated, trimmed and capped', () => {
  assert.deepEqual(sanitizeLabels([' VIP ', 'vip', 'Collab']).value, ['VIP', 'Collab']);
  const many = Array.from({ length: MAX_LABELS + 1 }, (_, index) => `Label ${index}`);
  const result = sanitizeLabels(many);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /at most/);
  assert.equal(sanitizeLabels(null).ok, false);
});

test('a paused inbox is public but unavailable, and away carries a note', () => {
  const recipient = user('bob', {
    dmSettings: { ...settingsWith({ stranger: 'request' }), availability: 'paused' }
  });
  const paused = describeDmPolicy({ recipient, viewer: user('alice') });
  assert.equal(paused.mode, 'paused');
  assert.equal(paused.allowed, false);
  assert.equal(paused.availability, 'paused');

  const awayRecipient = user('carol', {
    dmSettings: {
      ...settingsWith({ stranger: 'request' }),
      availability: 'away',
      awayMessage: 'Back after the weekend'
    }
  });
  const away = describeDmPolicy({ recipient: awayRecipient, viewer: user('alice') });
  assert.equal(away.allowed, true);
  assert.equal(away.availability, 'away');
  assert.equal(away.awayMessage, 'Back after the weekend');
});

test('request text rejects links and enforces the 300 character cap', () => {
  assert.equal(validateRequestText('gg, want to queue?').ok, true);
  assert.equal(validateRequestText('see https://example.com').ok, false);
  assert.equal(validateRequestText('www.example.com').ok, false);
  assert.equal(validateRequestText('join discord.gg/abc').ok, false);
  assert.equal(validateRequestText('I queue at 8 p.m.').ok, true);
  assert.equal(validateRequestText('x'.repeat(REQUEST_LIMITS.maxLength + 1)).ok, false);
});

test('request text strips control and bidi characters', () => {
  const result = validateRequestText('  hi\u202E there\u0007  ');
  assert.equal(result.ok, true);
  assert.equal(result.text, 'hi there');
});

test('business accounts use their own policy row for cold contact', () => {
  const gate = evaluateDmPermission({
    sender: user('business'),
    recipient: user('creator'),
    settings: settingsWith({ business: 'none' }),
    relationship: 'stranger',
    senderIsBusiness: true
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.code, 'DM_POLICY_NONE');
});

test('a structured business brief carries company, intent and budget', () => {
  const parsed = validateBusinessRequest({
    text: 'We would like to collaborate on a launch.',
    intent: 'collab',
    company: 'Sofia Studio',
    website: 'https://sofia.example',
    budgetBand: '500_2000',
    timeline: 'Next month',
    business: { displayName: 'Sofia Studio', website: 'https://sofia.example' }
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.company, 'Sofia Studio');
  assert.equal(parsed.value.budgetBand, '500_2000');
  assert.equal(parsed.value.timeline, 'Next month');
});

test('a business brief rejects a foreign domain and unknown intent', () => {
  const base = {
    text: 'A short brief.',
    company: 'Sofia Studio',
    business: { displayName: 'Sofia Studio', website: 'https://sofia.example' }
  };
  const domain = validateBusinessRequest({ ...base, intent: 'collab', website: 'https://other.example' });
  assert.equal(domain.ok, false);
  assert.match(domain.reason, /match/);

  const intent = validateBusinessRequest({ ...base, intent: 'unknown' });
  assert.equal(intent.ok, false);
  assert.match(intent.reason, /intent/);
});

test('quota allows a normal sender under every limit', () => {
  const quota = quotaState({
    sentToday: 1,
    sentThisWeek: 3,
    accountCreatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  });
  assert.equal(quota.allowed, true);
});

test('quota stops at the daily and weekly limits', () => {
  const established = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  assert.equal(quotaState({ sentToday: 5, sentThisWeek: 5, accountCreatedAt: established }).code, 'DM_QUOTA_DAY');
  assert.equal(quotaState({ sentToday: 0, sentThisWeek: 20, accountCreatedAt: established }).code, 'DM_QUOTA_WEEK');
});

test('new accounts get one request per day', () => {
  const now = Date.now();
  const quota = quotaState({
    sentToday: 1,
    sentThisWeek: 1,
    accountCreatedAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
    now
  });
  assert.equal(quota.allowed, false);
  assert.equal(quota.code, 'DM_QUOTA_DAY');
  assert.match(quota.reason, /New accounts/);
});

test('per-recipient contact is rate limited for 30 days', () => {
  const now = Date.now();
  const quota = quotaState({
    sentToday: 0,
    sentThisWeek: 0,
    lastRequestAt: new Date(now - 10 * 24 * 60 * 60 * 1000),
    now
  });
  assert.equal(quota.allowed, false);
  assert.equal(quota.code, 'DM_RECIPIENT_COOLDOWN');
});
