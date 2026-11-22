const Channel = require('../models/Channel');
const Message = require('../models/Message');
const SquadChat = require('../models/SquadChat');
const SquadChatMessage = require('../models/SquadChatMessage');
const User = require('../models/User');
const Notification = require('../models/Notification');
const MediaAsset = require('../models/MediaAsset');
const Post = require('../models/Post');
const Story = require('../models/Story');
const BroadcastMessage = require('../models/BroadcastMessage');
const Attachment = require('../models/Attachment');
const { cloudinary, deleteFromCloudinary } = require('../config/cloudinary');

const { getIO } = require('../config/socket');
const { eraseAccount } = require('../utils/accountErasure');
const { purgeExpiredDmRequests } = require('../utils/dmService');
const {
  expireAbandonedBusinessApplications,
  purgeExpiredBusinessEvidence,
  purgeExpiredBusinessAudits
} = require('../utils/businessRetention');

const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_MEDIA_HOURS = 24;
const ORPHAN_MEDIA_DAYS = 30;
const RUN_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
const DELETION_GRACE_DAYS = 30;

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
    const expired = await Message.find({
      channelId: channel._id,
      createdAt: { $lt: cutoff }
    }).select('_id').lean();
    if (!expired.length) continue;

    const messageIds = expired.map((message) => message._id);
    const attachments = await Attachment.find({ messageId: { $in: messageIds } })
      .select('_id assetId cloudinaryId mimeType')
      .lean();
    const assets = attachments.map((attachment) => attachment.assetId).filter(Boolean);

    await Promise.allSettled(attachments.map((attachment) => (
      attachment.cloudinaryId
        ? deleteFromCloudinary(attachment.cloudinaryId, attachment.mimeType?.startsWith('video/') ? 'video' : 'image')
        : Promise.resolve()
    )));

    const result = await Message.deleteMany({ _id: { $in: messageIds } });
    await Attachment.deleteMany({ _id: { $in: attachments.map((attachment) => attachment._id) } });
    if (assets.length) await MediaAsset.deleteMany({ _id: { $in: assets } });
    deleted += result.deletedCount || 0;
  }
  return deleted;
}

/**
 * Expire temporary squad chats and purge their messages.
 *
 * Expiry is also enforced at request time, so this sweep is only responsible
 * for reclaiming storage and telling open tabs to close the drawer.
 */
async function purgeExpiredSquadChats({ now = new Date() } = {}) {
  // A chat is due when it has timed out, or when request-time expiry already
  // flipped it to 'expired' but its messages were never reclaimed. `purgedAt`
  // keeps settled chats out of the scan.
  const expired = await SquadChat.find({
    purgedAt: null,
    $or: [
      { state: 'active', expiresAt: { $lte: now } },
      { state: 'expired' }
    ]
  })
    .select('_id')
    .lean();
  if (!expired.length) return { chats: 0, messages: 0 };

  const chatIds = expired.map((chat) => chat._id);
  const messages = await SquadChatMessage.deleteMany({ chatId: { $in: chatIds } });
  await SquadChat.updateMany(
    { _id: { $in: chatIds } },
    { $set: { state: 'expired', purgedAt: new Date() } }
  );

  for (const chatId of chatIds) {
    getIO()?.to(`squad:${chatId}`).emit('squad_chat_expired', { chatId: String(chatId) });
  }

  return { chats: chatIds.length, messages: messages.deletedCount || 0 };
}

/**
 * Remove ordinary notifications whose 15-day retention date has passed.
 * Durable notices have `retentionAt: null` and are deliberately untouched.
 * The Mongo TTL index performs the same deletion in the background; this sweep
 * makes the policy deterministic at startup and every six hours.
 */
async function purgeExpiredNotifications({ now = new Date() } = {}) {
  const result = await Notification.deleteMany({
    retentionAt: { $ne: null, $lte: now }
  });
  return result.deletedCount || 0;
}

/**
 * Hard-erase accounts whose deletion grace period has ended.
 *
 * The account document is anonymised in place (ids stay stable so old
 * references do not dangle) and the personal content that belongs to it is
 * removed. Everything that points at the person — follows, blocks, mutes,
 * memberships, invitations, notifications — is pulled.
 */
async function eraseDeletionPendingUsers({ now = new Date(), graceDays = DELETION_GRACE_DAYS } = {}) {
  const cutoff = new Date(now.getTime() - graceDays * DAY_MS);
  const users = await User.find({
    status: 'deletion_pending',
    deletionRequestedAt: { $lte: cutoff }
  })
    .select('_id sessionVersion')
    .lean();

  let erased = 0;
  for (const user of users) {
    try {
      // Shared with the "delete now" path: succession first, then erasure.
      const result = await eraseAccount(user);
      if (result.erased) erased += 1;
    } catch (err) {
      console.error(`[Retention] erase ${user._id} failed:`, err.message);
    }
  }
  return erased;
}

/**
 * Reclaim media that no content references.
 *
 * Pending rows older than a day mean an upload that never reached a post or
 * message; rejected rows are failed validation attempts; ready rows with no
 * ref after 30 days are genuinely orphaned. Each remote delete is best-effort
 * so one failure cannot stall the sweep.
 */
async function purgeOrphanMediaAssets({ now = new Date() } = {}) {
  const pendingCutoff = new Date(now.getTime() - PENDING_MEDIA_HOURS * 60 * 60 * 1000);
  const orphanCutoff = new Date(now.getTime() - ORPHAN_MEDIA_DAYS * DAY_MS);

  const rows = await MediaAsset.find({
    $or: [
      { status: 'pending', createdAt: { $lt: pendingCutoff } },
      { status: 'rejected', createdAt: { $lt: pendingCutoff } },
      { status: 'ready', refType: null, createdAt: { $lt: orphanCutoff } }
    ]
  })
    .select('_id publicId resourceType status')
    .limit(200)
    .lean();

  // Older uploads predate the refType backfill. Never trust `refType: null`
  // alone: verify that no live content owns the asset before destroying it.
  const readyIds = rows.filter((row) => row.status === 'ready').map((row) => row._id);
  const referenced = new Set();
  if (readyIds.length) {
    const [postRefs, storyRefs, broadcastRefs, attachmentRefs] = await Promise.all([
      Post.distinct('mediaAssetId', { mediaAssetId: { $in: readyIds } }),
      Story.distinct('mediaAssetId', { mediaAssetId: { $in: readyIds } }),
      BroadcastMessage.distinct('mediaAssetId', { mediaAssetId: { $in: readyIds } }),
      Attachment.distinct('assetId', { assetId: { $in: readyIds } })
    ]);
    for (const id of [...postRefs, ...storyRefs, ...broadcastRefs, ...attachmentRefs]) {
      if (id) referenced.add(String(id));
    }
  }

  let removed = 0;
  for (const row of rows) {
    if (row.status === 'ready' && referenced.has(String(row._id))) continue;
    try {
      await cloudinary.uploader.destroy(row.publicId, {
        resource_type: row.resourceType || 'image'
      });
    } catch {
      // A missing remote object must not block ledger cleanup.
    }
    await MediaAsset.deleteOne({ _id: row._id }).catch(() => {});
    removed += 1;
  }
  return removed;
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

    try {
      const squad = await purgeExpiredSquadChats();
      if (squad.chats > 0) {
        console.log(`[Retention] expired ${squad.chats} squad chat(s), purged ${squad.messages} message(s)`);
      }
    } catch (err) {
      console.error('[Retention] squad chat purge failed:', err.message);
    }

    try {
      const dm = await purgeExpiredDmRequests();
      if (dm.expired > 0 || dm.clearedDeclined > 0) {
        console.log(
          `[Retention] expired ${dm.expired} message request(s), cleared ${dm.clearedDeclined} declined opener(s)`
        );
      }
    } catch (err) {
      console.error('[Retention] message request purge failed:', err.message);
    }

    try {
      const notifications = await purgeExpiredNotifications();
      if (notifications > 0) {
        console.log(`[Retention] purged ${notifications} expired notification(s)`);
      }
    } catch (err) {
      console.error('[Retention] notification purge failed:', err.message);
    }

    try {
      const abandoned = await expireAbandonedBusinessApplications();
      if (abandoned.expired > 0) {
        console.log(`[Retention] expired ${abandoned.expired} abandoned business application(s)`);
      }
    } catch (err) {
      console.error('[Retention] abandoned application sweep failed:', err.message);
    }

    try {
      const evidence = await purgeExpiredBusinessEvidence();
      if (evidence.profiles > 0) {
        console.log(`[Retention] cleared review evidence for ${evidence.profiles} business profile(s)`);
      }
    } catch (err) {
      console.error('[Retention] business evidence purge failed:', err.message);
    }

    try {
      const businessAudits = await purgeExpiredBusinessAudits();
      if (businessAudits.audits > 0) {
        console.log(`[Retention] purged ${businessAudits.audits} expired business review audit row(s)`);
      }
    } catch (err) {
      console.error('[Retention] business audit purge failed:', err.message);
    }

    try {
      const erased = await eraseDeletionPendingUsers();
      if (erased > 0) console.log(`[Retention] erased ${erased} account(s) past the grace period`);
    } catch (err) {
      console.error('[Retention] account erasure failed:', err.message);
    }

    try {
      const media = await purgeOrphanMediaAssets();
      if (media > 0) console.log(`[Retention] reclaimed ${media} orphaned media asset(s)`);
    } catch (err) {
      console.error('[Retention] media sweep failed:', err.message);
    }
  };

  run();
  const timer = setInterval(run, RUN_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = {
  purgeExpiredMessages,
  purgeExpiredSquadChats,
  purgeExpiredNotifications,
  purgeOrphanMediaAssets,
  eraseDeletionPendingUsers,
  startRetentionWorker,
  purgeExpiredDmRequests,
  DELETION_GRACE_DAYS,
  RUN_INTERVAL_MS
};
