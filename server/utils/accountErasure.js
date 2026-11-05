/**
 * Permanent account erasure.
 *
 * One implementation for both paths — the 30-day retention sweep and the
 * owner's "delete now" action — so they cannot drift apart. Succession runs
 * before the account is anonymised: a server or squad must never be left
 * pointing at a deleted owner.
 *
 * The account document itself is anonymised in place. Its id stays stable so
 * old references (community messages, audit rows) do not dangle, while the
 * username and email are released for a fresh registration.
 */

const User = require('../models/User');
const { invalidateVisibility } = require('./visibility');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Community = require('../models/Community');
const Party = require('../models/Party');
const SquadChat = require('../models/SquadChat');
const SquadChatMessage = require('../models/SquadChatMessage');
const Invitation = require('../models/Invitation');
const Notification = require('../models/Notification');
const ForumPost = require('../models/ForumPost');
const ForumReply = require('../models/ForumReply');
const Attachment = require('../models/Attachment');

const { erasurePatch } = require('./privacy');
const { transferAllForUser } = require('./succession');

const idOf = (value) => String(value?._id || value || '');

/**
 * @param {object} user  a user document/lean object with `_id` (and ideally sessionVersion)
 * @returns {Promise<{erased: boolean, succession?: object, reason?: string}>}
 */
async function eraseAccount(user) {
  const userId = idOf(user);
  if (!userId) return { erased: false, reason: 'no-user' };

  // Re-read: the caller's snapshot may be stale (e.g. a cancellation race).
  const fresh = await User.findById(userId)
    .select('_id status sessionVersion')
    .lean();
  if (!fresh || fresh.status === 'deleted') {
    return { erased: false, reason: 'already-erased' };
  }

  const succession = await transferAllForUser(userId);

  // Claim the erasure first. A second sweep that lost the race must not delete
  // the same content twice or re-transfer ownership.
  const claim = await User.updateOne(
    { _id: userId, status: { $ne: 'deleted' } },
    erasurePatch(fresh)
  );
  if (!claim.modifiedCount) return { erased: false, reason: 'claim-lost' };

  // The tombstone must not linger in a cached visibility set.
  invalidateVisibility();

  // Posts owned by the account, and comments that either they wrote or that
  // lived on those posts. Saved-post references are pulled from everyone.
  const postIds = await Post.find({ userId }).distinct('_id');

  await Promise.all([
    Post.updateMany(
      { likes: userId },
      [
        { $set: { likes: { $filter: { input: '$likes', as: 'like', cond: { $ne: ['$$like', userId] } } } } },
        { $set: { likeCount: { $size: '$likes' } } }
      ]
    ),
    Post.deleteMany({ userId }),
    Comment.deleteMany({
      $or: [
        { userId },
        ...(postIds.length ? [{ postId: { $in: postIds } }] : [])
      ]
    }),
    Notification.deleteMany({ userId }),
    SquadChatMessage.deleteMany({ authorUserId: userId }),
    Invitation.deleteMany({ $or: [{ inviterUserId: userId }, { recipientUserId: userId }] }),
    ForumPost.deleteMany({ authorId: userId }),
    ForumReply.deleteMany({ authorId: userId }),
    Attachment.deleteMany({ uploaderId: userId }),

    Community.updateMany({ 'members.userId': userId }, { $pull: { members: { userId } } }),
    Party.updateMany({ 'members.userId': userId }, { $pull: { members: { userId } } }),
    Party.updateMany({ 'requests.userId': userId }, { $pull: { requests: { userId } } }),
    SquadChat.updateMany({ memberIds: userId }, { $pull: { memberIds: userId } }),

    User.updateMany(
      { _id: { $ne: userId } },
      { $pull: { followers: userId, following: userId, blockedUsers: userId, mutedUsers: userId } }
    ),
    ...(postIds.length
      ? [User.updateMany({ savedPosts: { $in: postIds } }, { $pull: { savedPosts: { $in: postIds } } })]
      : [])
  ]);

  return { erased: true, succession };
}

module.exports = { eraseAccount };
