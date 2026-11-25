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

const mongoose = require('mongoose');

const User = require('../models/User');
const { invalidateVisibility } = require('./visibility');
const relations = require('./relations');
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
const ProductEvent = require('../models/ProductEvent');
const Story = require('../models/Story');
const StoryView = require('../models/StoryView');
const BroadcastChannel = require('../models/BroadcastChannel');
const BroadcastMessage = require('../models/BroadcastMessage');
const BroadcastSubscription = require('../models/BroadcastSubscription');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const CommunityJoinRequest = require('../models/CommunityJoinRequest');
const AccountToken = require('../models/AccountToken');
const DmSenderReputation = require('../models/DmSenderReputation');
const Report = require('../models/Report');
const AuditLog = require('../models/AuditLog');
const BusinessProfile = require('../models/BusinessProfile');
const BusinessTeamMember = require('../models/BusinessTeamMember');
const MediaAsset = require('../models/MediaAsset');
const { deleteFromCloudinary } = require('../config/cloudinary');

const { erasurePatch } = require('./privacy');
const { transferAllForUser } = require('./succession');
const { tombstoneUserDm } = require('./dmService');

const idOf = (value) => String(value?._id || value || '');

/**
 * @param {object} user  a user document/lean object with `_id` (and ideally sessionVersion)
 * @returns {Promise<{erased: boolean, succession?: object, reason?: string}>}
 */
async function eraseAccount(user) {
  const userId = idOf(user);
  if (!userId) return { erased: false, reason: 'no-user' };

  // Re-read: the caller's snapshot may be stale (e.g. a cancellation race).
  const fresh = await User.findById(userId).select('_id status sessionVersion username').lean();
  if (!fresh || fresh.status === 'deleted') {
    return { erased: false, reason: 'already-erased' };
  }

  const succession = await transferAllForUser(userId);

  // Claim the erasure first. A second sweep that lost the race must not delete
  // the same content twice or re-transfer ownership.
  const claim = await User.updateOne(
    { _id: userId, status: { $ne: 'deleted' } },
    erasurePatch(fresh),
  );
  if (!claim.modifiedCount) return { erased: false, reason: 'claim-lost' };

  // The tombstone must not linger in a cached visibility set.
  invalidateVisibility();

  // Posts, comments, stories, broadcast channels and community messages that
  // belong to the account, plus the media ledger rows those objects point at.
  const postIds = await Post.find({ userId }).distinct('_id');
  const storyIds = await Story.find({ authorId: userId }).distinct('_id');
  const messageIds = await Message.find({ senderId: userId }).distinct('_id');
  const commentIds = await Comment.find({ userId }).distinct('_id');
  const forumPostIds = await ForumPost.find({ authorId: userId }).distinct('_id');
  const ownedChannelIds = await BroadcastChannel.find({ ownerId: userId }).distinct('_id');
  const subscribedChannelIds = await BroadcastSubscription.find({ userId }).distinct('channelId');
  const invitationIds = await Invitation.find({
    $or: [{ inviterUserId: userId }, { recipientUserId: userId }],
  }).distinct('_id');
  const conversationIds = await Conversation.find({ participantIds: userId }).distinct('_id');
  const joinRequestIds = await CommunityJoinRequest.find({ userId }).distinct('_id');

  const notificationRefs = [
    { userId },
    { 'metadata.followerId': String(userId) },
    { 'metadata.requesterId': String(userId) },
    { 'metadata.leaderId': String(userId) },
    { 'metadata.departedId': String(userId) },
    { 'metadata.ownerId': String(userId) },
    { 'metadata.memberId': String(userId) },
    ...(fresh.username ? [{ 'metadata.username': fresh.username }] : []),
    ...(commentIds.length ? [{ 'metadata.commentId': { $in: commentIds.map(String) } }] : []),
    ...(postIds.length ? [{ 'metadata.postId': { $in: postIds.map(String) } }] : []),
    ...(messageIds.length ? [{ 'metadata.messageId': { $in: messageIds.map(String) } }] : []),
    ...(ownedChannelIds.length
      ? [{ 'metadata.channelId': { $in: ownedChannelIds.map(String) } }]
      : []),
    ...(invitationIds.length
      ? [{ 'metadata.invitationId': { $in: invitationIds.map(String) } }]
      : []),
    ...(conversationIds.length
      ? [{ 'metadata.conversationId': { $in: conversationIds.map(String) } }]
      : []),
    ...(joinRequestIds.length
      ? [{ 'metadata.requestId': { $in: joinRequestIds.map(String) } }]
      : []),
  ];

  const mediaRows = await MediaAsset.find({
    $or: [
      { ownerId: userId },
      ...(postIds.length ? [{ refType: 'Post', refId: { $in: postIds } }] : []),
      ...(storyIds.length ? [{ refType: 'Story', refId: { $in: storyIds } }] : []),
    ],
  })
    .select('_id publicId resourceType')
    .lean();

  // Remote objects are best-effort: a Cloudinary outage must not leave the
  // account half-erased in the database.
  await Promise.allSettled(
    mediaRows.map((row) => deleteFromCloudinary(row.publicId, row.resourceType || 'image')),
  );

  const objectId = new mongoose.Types.ObjectId(userId);

  await Promise.all([
    Post.updateMany({ likes: objectId }, [
      {
        $set: {
          likes: { $filter: { input: '$likes', as: 'like', cond: { $ne: ['$$like', objectId] } } },
        },
      },
      { $set: { likeCount: { $size: '$likes' } } },
    ]),
    Post.deleteMany({ userId }),
    Comment.deleteMany({
      $or: [{ userId }, ...(postIds.length ? [{ postId: { $in: postIds } }] : [])],
    }),
    Story.deleteMany({ authorId: userId }),
    StoryView.deleteMany({
      $or: [{ viewerId: userId }, ...(storyIds.length ? [{ storyId: { $in: storyIds } }] : [])],
    }),
    BroadcastChannel.deleteMany({ ownerId: userId }),
    BroadcastMessage.deleteMany({
      $or: [
        { authorId: userId },
        ...(ownedChannelIds.length ? [{ channelId: { $in: ownedChannelIds } }] : []),
      ],
    }),
    BroadcastSubscription.deleteMany({
      $or: [
        { userId },
        ...(ownedChannelIds.length ? [{ channelId: { $in: ownedChannelIds } }] : []),
      ],
    }),
    ...(subscribedChannelIds.length
      ? [
          BroadcastChannel.updateMany(
            { _id: { $in: subscribedChannelIds }, subscriberCount: { $gt: 0 } },
            { $inc: { subscriberCount: -1 } },
          ),
        ]
      : []),
    Message.updateMany(
      { senderId: userId },
      {
        $set: {
          text: '[deleted]',
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: userId,
          attachments: [],
          reactions: [],
          mentions: [],
        },
      },
    ),
    // Other people's replies quote a snapshot of this account's words, and
    // mentions carry its username. Scrub both; the tombstone alone would leave
    // personal content in other users' message rows.
    Message.updateMany(
      { $or: [{ 'replyTo.messageId': { $in: messageIds } }, { 'mentions.userId': objectId }] },
      [
        {
          $set: {
            replyTo: {
              $cond: [
                { $in: ['$replyTo.messageId', messageIds] },
                { $mergeObjects: ['$replyTo', { preview: '[deleted]', senderName: '[deleted]' }] },
                '$replyTo',
              ],
            },
            mentions: {
              $filter: {
                input: { $ifNull: ['$mentions', []] },
                as: 'mention',
                cond: { $ne: ['$$mention.userId', objectId] },
              },
            },
          },
        },
      ],
    ),
    BusinessProfile.deleteMany({ userId }),
    BusinessTeamMember.deleteMany({
      $or: [{ businessOwnerId: userId }, { memberId: userId }],
    }),
    MediaAsset.deleteMany({ _id: { $in: mediaRows.map((row) => row._id) } }),
    // Notifications received by this account, plus pings to other people that
    // quote its handle or point at content that is being erased.
    Notification.deleteMany({ $or: notificationRefs }),
    CommunityJoinRequest.deleteMany({ userId }),
    AccountToken.deleteMany({ userId }),
    DmSenderReputation.deleteMany({ userId }),
    Report.deleteMany({
      $or: [
        { reporterId: userId },
        { targetType: 'member', targetId: userId },
        ...(messageIds.length ? [{ targetType: 'message', targetId: { $in: messageIds } }] : []),
        ...(forumPostIds.length
          ? [{ targetType: 'forumPost', targetId: { $in: forumPostIds } }]
          : []),
      ],
    }),
    // Audit rows stay for moderation history, but no row may keep the released
    // handle in its metadata snapshot.
    ...(fresh.username
      ? [
          AuditLog.updateMany({ 'metadata.username': fresh.username }, [
            { $set: { metadata: { $mergeObjects: ['$metadata', { username: '[deleted]' }] } } },
          ]),
        ]
      : []),
    ProductEvent.deleteMany({ userId }),
    SquadChatMessage.deleteMany({ authorUserId: userId }),
    Invitation.deleteMany({ $or: [{ inviterUserId: userId }, { recipientUserId: userId }] }),
    ForumPost.deleteMany({ authorId: userId }),
    ForumReply.deleteMany({ authorId: userId }),
    Attachment.deleteMany({ uploaderId: userId }),

    Community.updateMany({ 'members.userId': userId }, { $pull: { members: { userId } } }),
    Party.updateMany({ 'members.userId': userId }, { $pull: { members: { userId } } }),
    Party.updateMany({ 'requests.userId': userId }, { $pull: { requests: { userId } } }),
    SquadChat.updateMany({ memberIds: userId }, { $pull: { memberIds: userId } }),
    // Keep the other participant's thread shape, but never their private copy
    // of this person's words after erasure.
    tombstoneUserDm(userId),

    relations.eraseRelations(userId),
    ...(postIds.length ? [relations.removeSavedForPosts(postIds)] : []),
  ]);

  return { erased: true, succession };
}

module.exports = { eraseAccount };
