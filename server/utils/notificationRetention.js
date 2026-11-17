/**
 * Notification retention policy.
 *
 * Ordinary notifications live for at most 15 days. A small set of durable
 * notices — invitations, follow requests, account/security alerts and other
 * explicitly marked system notices — are kept until their own lifecycle removes
 * them, because losing them can make an account action impossible to complete.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const NOTIFICATION_TTL_DAYS = 15;
const NOTIFICATION_TTL_MS = NOTIFICATION_TTL_DAYS * DAY_MS;

const DURABLE_KIND_PREFIXES = [
  'invitation',
  'system_',
  'account_security',
  'account_deletion',
  'security_',
  'community_join_',
  'business_team_invite'
];

function isImportantNotification(notificationOrMetadata) {
  const metadata = notificationOrMetadata?.metadata ?? notificationOrMetadata;
  if (!metadata || typeof metadata !== 'object') return false;
  if (metadata.important === true) return true;
  if (String(metadata.retention || '').toLowerCase() === 'important') return true;

  const kind = String(metadata.kind || '').toLowerCase();
  if (!kind) return false;
  if (kind === 'follow_request') return true;
  return DURABLE_KIND_PREFIXES.some((prefix) => kind.startsWith(prefix));
}

/**
 * Date used by the TTL index. `null` means "never expires automatically".
 */
function retentionAtFor(notificationOrMetadata, { now = new Date() } = {}) {
  if (isImportantNotification(notificationOrMetadata)) return null;
  return new Date(now.getTime() + NOTIFICATION_TTL_MS);
}

module.exports = {
  DAY_MS,
  NOTIFICATION_TTL_DAYS,
  NOTIFICATION_TTL_MS,
  isImportantNotification,
  retentionAtFor
};
