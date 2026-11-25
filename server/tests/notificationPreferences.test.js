const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_NOTIFICATION_SETTINGS,
  normalizeNotificationSettings,
  sanitizeNotificationSettingsPatch,
  notificationCategory,
  isNotificationCategoryEnabled,
} = require('../utils/notificationPreferences');

test('missing preferences default to enabled without sharing the frozen object', () => {
  const settings = normalizeNotificationSettings(null);

  assert.deepEqual(settings, DEFAULT_NOTIFICATION_SETTINGS);
  assert.notEqual(settings, DEFAULT_NOTIFICATION_SETTINGS);
  assert.deepEqual(normalizeNotificationSettings({ comments: false }), {
    comments: false,
    follows: true,
    likes: true,
    lfg: true,
    bot: true,
    broadcast: true,
  });
});

test('a stored non-boolean is treated as enabled rather than silently muting', () => {
  assert.equal(normalizeNotificationSettings({ comments: 'false' }).comments, true);
  assert.equal(normalizeNotificationSettings({ comments: 0 }).comments, true);
});

test('a partial patch accepts booleans and rejects unknown or non-boolean keys', () => {
  assert.deepEqual(sanitizeNotificationSettingsPatch({ comments: false, lfg: true }), {
    ok: true,
    value: { comments: false, lfg: true },
  });

  const empty = sanitizeNotificationSettingsPatch({});
  assert.equal(empty.ok, false);
  assert.match(empty.errors[0], /at least one/i);

  const unknown = sanitizeNotificationSettingsPatch({ mentions: false });
  assert.equal(unknown.ok, false);
  assert.match(unknown.errors[0], /Unknown notification preference/);

  const wrongType = sanitizeNotificationSettingsPatch({ follows: 'off' });
  assert.equal(wrongType.ok, false);
  assert.match(wrongType.errors[0], /true or false/);
});

test('notification categories map existing and future kinds to preference rows', () => {
  assert.equal(notificationCategory({ type: 'lfg_request' }), 'lfg');
  assert.equal(notificationCategory({ type: 'lfg_accepted' }), 'lfg');
  assert.equal(notificationCategory({ type: 'gaming_bot' }), 'bot');
  assert.equal(notificationCategory({ type: 'broadcast' }), 'broadcast');
  assert.equal(notificationCategory({ type: 'social', metadata: { kind: 'comment' } }), 'comments');
  assert.equal(notificationCategory({ type: 'social', metadata: { kind: 'reply' } }), 'comments');
  assert.equal(notificationCategory({ type: 'social', metadata: { kind: 'follow' } }), 'follows');
  assert.equal(
    notificationCategory({ type: 'social', metadata: { kind: 'like_milestone' } }),
    'likes',
  );
  assert.equal(notificationCategory({ type: 'social', metadata: { kind: 'mention' } }), null);
  assert.equal(notificationCategory({ type: 'social' }), null);
});

test('uncategorised notifications remain enabled when every preference is off', () => {
  const off = { comments: false, follows: false, likes: false, lfg: false, bot: false };

  assert.equal(isNotificationCategoryEnabled(off, null), true);
  assert.equal(isNotificationCategoryEnabled(off, 'lfg'), false);
  assert.equal(isNotificationCategoryEnabled({}, 'bot'), true);
});
