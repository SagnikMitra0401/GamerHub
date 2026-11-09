const User = require('../models/User');
const Conversation = require('../models/Conversation');
const { notifyUser } = require('../utils/notify');
const { normalizeDmSettings, isQuietHours } = require('../utils/dmPolicy');

const DIGEST_START_HOUR = 8;
const MAX_USERS_PER_RUN = 500;

function localParts(now, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    weekday: 'short',
    hourCycle: 'h23'
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: Number(get('hour')) || 0,
    weekday: get('weekday')
  };
}

function digestPeriodKey(settings, now = new Date()) {
  const quiet = normalizeDmSettings(settings).quietHours;
  let local;
  try {
    local = localParts(now, quiet.timezone);
  } catch {
    local = localParts(now, 'UTC');
  }
  return `${local.year}-${local.month}-${local.day}`;
}

function digestDue(settings, now = new Date()) {
  const normalized = normalizeDmSettings(settings);
  if (normalized.digest === 'off') return false;
  if (isQuietHours(normalized, now)) return false;

  let local;
  try {
    local = localParts(now, normalized.quietHours.timezone);
  } catch {
    local = localParts(now, 'UTC');
  }
  if (local.hour < DIGEST_START_HOUR) return false;
  return normalized.digest === 'daily' || local.weekday === 'Mon';
}

function buildDigest({ requests = 0, unread = 0 } = {}) {
  const parts = [];
  if (requests > 0) parts.push(`${requests} request${requests === 1 ? '' : 's'} waiting`);
  if (unread > 0) parts.push(`${unread} unread message${unread === 1 ? '' : 's'}`);
  if (!parts.length) return null;
  return {
    title: 'Your message digest',
    message: parts.join(' · '),
    actionUrl: requests > 0 ? '/messages?folder=requests' : '/messages'
  };
}

async function digestCounts(userId, now = new Date()) {
  const [requests, active] = await Promise.all([
    Conversation.countDocuments({
      recipientId: userId,
      state: 'request',
      requestExpiresAt: { $gt: now },
      filteredAt: null
    }),
    Conversation.find({
      participantIds: userId,
      state: 'active',
      archivedBy: { $ne: userId }
    }).select('unreadCounts').lean()
  ]);

  const unread = active.reduce((total, conversation) => (
    total + (Number(conversation.unreadCounts?.[String(userId)]) || 0)
  ), 0);
  return { requests, unread };
}

async function sendDmDigests({ now = new Date() } = {}) {
  // `$ne` also matches accounts written before dmSettings existed; normalize()
  // treats those as the default daily digest.
  const users = await User.find({ 'dmSettings.digest': { $ne: 'off' } })
    .select('_id dmSettings')
    .limit(MAX_USERS_PER_RUN)
    .lean();

  let sent = 0;
  for (const user of users) {
    const settings = normalizeDmSettings(user.dmSettings);
    if (!digestDue(settings, now)) continue;

    try {
      const counts = await digestCounts(user._id, now);
      const digest = buildDigest(counts);
      if (!digest) continue;

      const notification = await notifyUser({
        userId: user._id,
        type: 'social',
        title: digest.title,
        message: digest.message,
        actionUrl: digest.actionUrl,
        metadata: { kind: 'dm_digest', ...counts },
        dedupeKey: `dm-digest:${String(user._id)}:${settings.digest}:${digestPeriodKey(settings, now)}`
      });
      if (notification) sent += 1;
    } catch (err) {
      console.error(`[DM digest] ${String(user._id)} failed:`, err.message);
    }
  }
  return sent;
}

let timer = null;
let startupTimer = null;

function startDmDigestWorker({ intervalMs = 60 * 60 * 1000 } = {}) {
  if (timer) return timer;
  const run = () => sendDmDigests().catch((err) => {
    console.error('[DM digest] run failed:', err.message);
  });

  timer = setInterval(run, intervalMs);
  if (timer.unref) timer.unref();
  startupTimer = setTimeout(run, 30 * 1000);
  if (startupTimer.unref) startupTimer.unref();
  return timer;
}

module.exports = {
  DIGEST_START_HOUR,
  localParts,
  digestPeriodKey,
  digestDue,
  buildDigest,
  digestCounts,
  sendDmDigests,
  startDmDigestWorker
};
