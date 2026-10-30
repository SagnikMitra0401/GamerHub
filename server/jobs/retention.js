const Channel = require('../models/Channel');
const Message = require('../models/Message');
const SquadChat = require('../models/SquadChat');
const SquadChatMessage = require('../models/SquadChatMessage');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Community = require('../models/Community');
const Party = require('../models/Party');
const Invitation = require('../models/Invitation');
const Notification = require('../models/Notification');
const User = require('../models/User');

const { getIO } = require('../config/socket');
const { erasurePatch } = require('../utils/privacy');

const DAY_MS = 24 * 60 * 60 * 1000;
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
    const result = await Message.deleteMany({
      channelId: channel._id,
      createdAt: { $lt: cutoff }
    });
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
    const patch = erasurePatch(user);
    const claim = await User.updateOne(
      { _id: user._id, status: 'deletion_pending' },
      patch
    );
    if (!claim.modifiedCount) continue;

    await Promise.all([
      Post.deleteMany({ userId: user._id }),
      Comment.deleteMany({ userId: user._id }),
      Notification.deleteMany({ userId: user._id }),
      SquadChatMessage.deleteMany({ authorUserId: user._id }),
      Invitation.deleteMany({ $or: [{ inviterUserId: user._id }, { recipientUserId: user._id }] }),
      Community.updateMany({ 'members.userId': user._id }, { $pull: { members: { userId: user._id } } }),
      Party.updateMany({ 'members.userId': user._id }, { $pull: { members: { userId: user._id } } }),
      Party.updateMany(
        { leaderId: user._id, status: { $ne: 'closed' } },
        { $set: { status: 'closed', state: 'cancelled', completedAt: new Date() } }
      ),
      User.updateMany(
        {},
        { $pull: { followers: user._id, following: user._id, blockedUsers: user._id, mutedUsers: user._id } }
      )
    ]);

    erased += 1;
  }
  return erased;
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
      const erased = await eraseDeletionPendingUsers();
      if (erased > 0) console.log(`[Retention] erased ${erased} account(s) past the grace period`);
    } catch (err) {
      console.error('[Retention] account erasure failed:', err.message);
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
  eraseDeletionPendingUsers,
  startRetentionWorker,
  DELETION_GRACE_DAYS,
  RUN_INTERVAL_MS
};
