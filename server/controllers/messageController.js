/**
 * Message-level extras: reactions, pinning and in-server search.
 *
 * Everything here is REST (not socket) on purpose: reactions are an isolated,
 * idempotent toggle and a broadcast, so they do not belong in the chat hot path
 * where a dropped frame would silently lose a like.
 */
const mongoose = require('mongoose');

const Message = require('../models/Message');
const ForumPost = require('../models/ForumPost');
const Channel = require('../models/Channel');
const Community = require('../models/Community');

const { CAP, communityPermissions, roleAtLeast } = require('../utils/permissions');
const { serializeReactions, normalizeReaction, MAX_REACTIONS_PER_MESSAGE } = require('../utils/reactions');
const { loadChannelAccess } = require('../utils/channelAccess');
const { sanitizeLine } = require('../utils/sanitize');
const { recordAudit } = require('../utils/audit');
const { badRequest, forbidden, notFound } = require('../utils/httpError');
const { parsePagination } = require('../utils/pagination');
const { emitToChannel } = require('../config/socket');
const { createSlidingWindowLimiter } = require('../utils/rateLimiter');

const reactionLimiter = createSlidingWindowLimiter({ windowMs: 10_000, max: 40 });

/** Reset the in-memory reaction budget (tests). */
const resetReactionLimiter = () => reactionLimiter.reset();

// ─── POST /api/communities/channels/:channelId/messages/:messageId/react ────
const toggleReaction = async (req, res, next) => {
  try {
    const budget = reactionLimiter.consume(String(req.user._id));
    if (!budget.allowed) {
      throw badRequest('You are reacting very fast — give it a moment.');
    }

    const { channel } = await loadChannelAccess({
      channelId: req.params.channelId,
      userId: req.user._id,
      capability: CAP.ADD_REACTIONS
    });

    const emoji = normalizeReaction(req.body.emoji);
    if (!emoji) throw badRequest('That reaction is not available.');
    if (!mongoose.Types.ObjectId.isValid(String(req.params.messageId))) {
      throw badRequest('Invalid message id');
    }

    const message = await Message.findOne({
      _id: req.params.messageId,
      channelId: channel._id
    }).select('reactions isDeleted channelId').lean();

    if (!message || message.isDeleted) throw notFound('Message not found.');

    const userId = req.user._id;
    const role = (message.reactions || []).find((entry) => entry.emoji === emoji);

    if (role) {
      const alreadyReacted = (role.users || []).some((id) => String(id) === String(userId));
      await Message.updateOne(
        { _id: message._id, 'reactions.emoji': emoji },
        alreadyReacted
          ? { $pull: { 'reactions.$.users': userId } }
          : { $addToSet: { 'reactions.$.users': userId } }
      );
    } else {
      if ((message.reactions || []).length >= MAX_REACTIONS_PER_MESSAGE) {
        throw badRequest('This message already has the maximum number of reactions.');
      }
      // The filter makes the push idempotent under a double click: if another
      // request created the slot first, this update simply matches nothing.
      await Message.updateOne(
        { _id: message._id, 'reactions.emoji': { $ne: emoji } },
        { $push: { reactions: { emoji, users: [userId] } } }
      );
    }

    const updated = await Message.findById(message._id).select('reactions').lean();
    const summary = serializeReactions(updated?.reactions, userId);

    emitToChannel(channel._id, 'reaction_updated', {
      channelId: String(channel._id),
      messageId: String(message._id),
      reactions: serializeReactions(updated?.reactions),
      actorId: String(userId),
      emoji
    });

    res.status(200).json({ messageId: String(message._id), reactions: summary });
  } catch (err) {
    next(err);
  }
};

// ─── POST / DELETE .../messages/:messageId/pin ──────────────────────────────
const togglePin = async (req, res, next) => {
  try {
    const { channel, community } = await loadChannelAccess({
      channelId: req.params.channelId,
      userId: req.user._id,
      capability: CAP.PIN_MESSAGES
    });

    if (!mongoose.Types.ObjectId.isValid(String(req.params.messageId))) {
      throw badRequest('Invalid message id');
    }

    const message = await Message.findOne({
      _id: req.params.messageId,
      channelId: channel._id
    }).select('pinned isDeleted channelId').lean();

    if (!message || message.isDeleted) throw notFound('Message not found.');

    const pinned = !message.pinned;
    await Message.updateOne({ _id: message._id }, { $set: { pinned } });

    recordAudit({
      communityId: community._id,
      actorId: req.user._id,
      actionType: pinned ? 'MESSAGE_PIN' : 'MESSAGE_UNPIN',
      targetId: message._id,
      targetModel: 'Message',
      metadata: { channelId: String(channel._id) }
    });

    emitToChannel(channel._id, pinned ? 'message_pinned' : 'message_unpinned', {
      channelId: String(channel._id),
      messageId: String(message._id)
    });

    res.status(200).json({ messageId: String(message._id), pinned });
  } catch (err) {
    next(err);
  }
};

// ─── GET .../channels/:channelId/pins ───────────────────────────────────────
const getPinnedMessages = async (req, res, next) => {
  try {
    const { channel } = await loadChannelAccess({
      channelId: req.params.channelId,
      userId: req.user._id
    });

    const { limit } = parsePagination(req.query, { defaultLimit: 25, maxLimit: 50 });

    const messages = await Message.find({
      channelId: channel._id,
      pinned: true,
      isDeleted: false
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('senderId', 'username level')
      .lean();

    res.status(200).json({
      messages: messages.map((message) => ({
        ...message,
        reactions: serializeReactions(message.reactions)
      }))
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/communities/:id/search?q=&channelId= ──────────────────────────
const searchMessages = async (req, res, next) => {
  try {
    const community = await Community.findById(req.params.id).lean();
    if (!community) throw notFound('Community not found.');

    const { role, permissions } = communityPermissions(community, req.user._id);
    if (!role) throw forbidden('Join this server to search it.');
    if (!permissions.includes(CAP.VIEW_CHANNEL)) {
      throw forbidden('You do not have permission to search this server.');
    }

    const q = sanitizeLine(req.query.q, 100);
    if (q.length < 2) throw badRequest('Search for at least 2 characters.');

    // Only channels this role may read — a search hit must never come from a
    // channel the caller cannot open.
    const allChannels = await Channel.find({ communityId: community._id }).lean();
    let accessible = allChannels.filter((channel) => roleAtLeast(role, channel.minRoleToRead));

    if (req.query.channelId) {
      accessible = accessible.filter((channel) => String(channel._id) === String(req.query.channelId));
      if (!accessible.length) throw forbidden('You cannot search that channel.');
    }

    const channelIds = accessible.map((channel) => channel._id);
    const { limit } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 30 });

    const messages = channelIds.length
      ? await Message.find(
        { channelId: { $in: channelIds }, isDeleted: false, $text: { $search: q } },
        { score: { $meta: 'textScore' } }
      )
        .sort({ score: { $meta: 'textScore' }, createdAt: -1 })
        .limit(limit)
        .populate('senderId', 'username level')
        .lean()
      : [];

    const forumChannelIds = accessible
      .filter((channel) => channel.type === 'forum')
      .map((channel) => channel._id);

    const forumPosts = forumChannelIds.length
      ? await ForumPost.find(
        { channelId: { $in: forumChannelIds }, isDeleted: false, $text: { $search: q } },
        { score: { $meta: 'textScore' } }
      )
        .sort({ score: { $meta: 'textScore' }, createdAt: -1 })
        .limit(limit)
        .populate('authorId', 'username level')
        .select('title tags status channelId authorId createdAt replyCount')
        .lean()
      : [];

    const channelNameById = new Map(allChannels.map((channel) => [String(channel._id), channel.name]));

    res.status(200).json({
      query: q,
      messages: messages.map((message) => ({
        _id: message._id,
        channelId: message.channelId,
        channelName: channelNameById.get(String(message.channelId)) || null,
        text: message.text,
        createdAt: message.createdAt,
        sender: message.senderId
          ? { _id: message.senderId._id, username: message.senderId.username, level: message.senderId.level }
          : null
      })),
      forumPosts: forumPosts.map((post) => ({
        _id: post._id,
        channelId: post.channelId,
        channelName: channelNameById.get(String(post.channelId)) || null,
        title: post.title,
        tags: post.tags,
        status: post.status,
        replyCount: post.replyCount,
        createdAt: post.createdAt,
        author: post.authorId
          ? { _id: post.authorId._id, username: post.authorId.username }
          : null
      }))
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  toggleReaction,
  togglePin,
  getPinnedMessages,
  searchMessages,
  resetReactionLimiter
};
