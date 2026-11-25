const Notification = require('../models/Notification');
const User = require('../models/User');
const { getIO } = require('../config/socket');
const { sanitizeLine, isHttpUrl } = require('./sanitize');
const relations = require('./relations');
const {
  notificationCategory,
  isNotificationCategoryEnabled,
} = require('./notificationPreferences');

const MAX_TITLE = 120;
const MAX_MESSAGE = 300;

/** Internal routes only (no scheme) or absolute https URLs. */
function safeActionUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed.slice(0, 500);
  if (/^https:\/\//i.test(trimmed) && isHttpUrl(trimmed)) return trimmed.slice(0, 500);
  return null;
}

const safeThumbnail = (value) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return /^https:\/\//i.test(trimmed) && isHttpUrl(trimmed) ? trimmed.slice(0, 500) : null;
};

/**
 * Persist a notification and push it to the recipient's open tabs.
 * Never throws: a failed ping must not break the action that caused it.
 *
 * @param {object} input
 * @param {string|import('mongoose').Types.ObjectId} input.userId
 * @param {'lfg_request'|'lfg_accepted'|'gaming_bot'|'social'|'broadcast'} [input.type]
 * @param {string} [input.actorId] the account that caused the ping, for block checks
 * @param {string} input.title folded to one line and capped at 120 characters
 * @param {string} [input.message] folded to one line and capped at 300 characters
 * @param {string} [input.actionUrl] internal route or https URL
 * @param {string} [input.mediaThumbnail] https URL
 * @param {object} [input.metadata] category hints and payload, never rendered raw
 * @param {string} [input.dedupeKey] when set, the same ping is never stored twice
 * @param {boolean} [input.silent] skip the live push, keep the stored row
 * @returns {Promise<object|null>} the created notification, or null
 */
async function notifyUser({
  userId,
  type = 'social',
  actorId = null,
  title,
  message = '',
  actionUrl = null,
  mediaThumbnail = null,
  metadata = {},
  dedupeKey,
  silent = false,
}) {
  try {
    if (!userId) return null;

    // Stealth mode silences pings: nothing is written or pushed while frozen,
    // suspended or deleted.
    const recipient = await User.findById(userId).select('status notificationSettings').lean();
    if (
      !recipient ||
      ['frozen', 'suspended', 'deleted', 'deletion_pending'].includes(recipient.status)
    ) {
      return null;
    }

    // Social actions must not leak through a block in either direction. Calls
    // without an actor (system-generated pings, bot finds) skip this read.
    if (actorId) {
      const actor = await User.findById(actorId).select('status').lean();
      if (
        !actor ||
        ['frozen', 'suspended', 'deleted', 'deletion_pending'].includes(actor.status) ||
        (await relations.isBlockedPair(recipient._id, actor._id))
      ) {
        return null;
      }
    }

    // A switched-off category stops the ping at the source. Existing history
    // stays readable, and uncategorised pings (DMs, invitations) are untouched.
    const category = notificationCategory({ type, metadata });
    if (category && !isNotificationCategoryEnabled(recipient?.notificationSettings, category)) {
      return null;
    }

    const doc = {
      userId,
      type,
      title: sanitizeLine(title, MAX_TITLE) || 'GamerHub',
      message: sanitizeLine(message, MAX_MESSAGE),
      actionUrl: safeActionUrl(actionUrl),
      mediaThumbnail: safeThumbnail(mediaThumbnail),
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
    };

    if (dedupeKey) {
      const key = sanitizeLine(dedupeKey, 200);
      const existing = key ? await Notification.exists({ userId, dedupeKey: key }) : null;
      if (existing) return null;
      doc.dedupeKey = key;
    }

    const notification = await Notification.create(doc);

    if (!silent) {
      getIO()
        ?.to(`user:${String(userId)}`)
        .emit('notification', {
          ...notification.toObject(),
          unread: true,
        });
    }

    return notification;
  } catch (err) {
    // A duplicate dedupeKey under a race is expected; anything else is worth logging.
    if (err.code !== 11000) console.error('[Notify] failed:', err.message);
    return null;
  }
}

module.exports = { notifyUser, safeActionUrl, safeThumbnail };
