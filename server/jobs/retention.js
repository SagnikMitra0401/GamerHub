const Channel = require('../models/Channel');
const Message = require('../models/Message');

const DAY_MS = 24 * 60 * 60 * 1000;
const RUN_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

/**
 * Delete messages older than each channel's `retentionDays`.
 * Channels with retentionDays = 0 keep history forever.
 *
 * @returns {Promise<number>} number of deleted messages
 */
async function purgeExpiredMessages({ now = new Date() } = {}) {
  const channels = await Channel.find({ retentionDays: { $gt: 0 } })
    .select('_id retentionDays')
    .lean();

  let deleted = 0;
  for (const channel of channels) {
    const cutoff = new Date(now.getTime() - channel.retentionDays * DAY_MS);
    const result = await Message.deleteMany({
      channelId: channel._id,
      createdAt: { $lt: cutoff }
    });
    deleted += result.deletedCount || 0;
  }
  return deleted;
}

/** Start the periodic worker. Disable with DISABLE_RETENTION_WORKER=1 (tests). */
function startRetentionWorker() {
  if (process.env.DISABLE_RETENTION_WORKER === '1') return null;

  const run = async () => {
    try {
      const deleted = await purgeExpiredMessages();
      if (deleted > 0) console.log(`[Retention] purged ${deleted} expired message(s)`);
    } catch (err) {
      console.error('[Retention] purge failed:', err.message);
    }
  };

  run();
  const timer = setInterval(run, RUN_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = { purgeExpiredMessages, startRetentionWorker, RUN_INTERVAL_MS };
