/**
 * Per-category notification preferences.
 *
 * These are written into `User.notificationSettings` and consulted by
 * `notifyUser` before a notification is persisted. A missing subdocument or a
 * missing field means "on" so accounts created before this feature keep the
 * behaviour they had.
 */
const CATEGORY_KEYS = ['comments', 'follows', 'likes', 'lfg', 'bot', 'broadcast'];

const DEFAULT_NOTIFICATION_SETTINGS = Object.freeze({
  comments: true,
  follows: true,
  likes: true,
  lfg: true,
  bot: true,
  broadcast: true
});

function normalizeNotificationSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return CATEGORY_KEYS.reduce((settings, key) => {
    settings[key] = typeof source[key] === 'boolean' ? source[key] : true;
    return settings;
  }, {});
}

function sanitizeNotificationSettingsPatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: ['Send an object of notification preferences.'] };
  }

  const entries = Object.entries(body);
  if (entries.length === 0) {
    return { ok: false, errors: ['Choose at least one notification preference.'] };
  }

  const errors = [];
  const value = {};

  for (const [key, setting] of entries) {
    if (!CATEGORY_KEYS.includes(key)) {
      errors.push(`Unknown notification preference: ${key}`);
    } else if (typeof setting !== 'boolean') {
      errors.push(`${key} must be true or false.`);
    } else {
      value[key] = setting;
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, value };
}

/**
 * Map the persisted notification kinds to the user-facing preference. Social
 * pings without a recognised `metadata.kind` (DMs, invitations, requests) are
 * intentionally uncategorised; they are not part of the five preference rows
 * and must keep working when all five are off.
 */
function notificationCategory({ type, metadata } = {}) {
  if (type === 'lfg_request' || type === 'lfg_accepted') return 'lfg';
  if (type === 'gaming_bot') return 'bot';
  if (type === 'broadcast') return 'broadcast';

  const kind = String(metadata?.kind || '').toLowerCase();
  if (kind.includes('comment') || kind.includes('reply')) return 'comments';
  if (kind.includes('follow')) return 'follows';
  if (kind.includes('like')) return 'likes';
  return null;
}

function isNotificationCategoryEnabled(rawSettings, category) {
  if (!category) return true;
  return normalizeNotificationSettings(rawSettings)[category] !== false;
}

module.exports = {
  CATEGORY_KEYS,
  DEFAULT_NOTIFICATION_SETTINGS,
  normalizeNotificationSettings,
  sanitizeNotificationSettingsPatch,
  notificationCategory,
  isNotificationCategoryEnabled
};
