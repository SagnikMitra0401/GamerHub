/**
 * Forum channels.
 *
 * A forum channel replaces the live message stream with threads: a post with a
 * title, tags and a status, plus flat replies. Reads and writes are gated exactly
 * like text channels (membership -> capability -> channel role gate), and a post
 * id is never enough on its own: every lookup is scoped by channel + community.
 */
const mongoose = require('mongoose');

const ForumPost = require('../models/ForumPost');
const ForumReply = require('../models/ForumReply');
const Channel = require('../models/Channel');

const { CAP, communityPermissions, roleAtLeast } = require('../utils/permissions');
const { loadChannelAccess } = require('../utils/channelAccess');
const { sanitizeLine, normalizeTags } = require('../utils/sanitize');
const { recordAudit } = require('../utils/audit');
const { parsePagination } = require('../utils/pagination');
const { badRequest, forbidden, notFound } = require('../utils/httpError');
const { emitToChannel } = require('../config/socket');
const { FORUM_STATUSES } = require('../models/ForumPost');

const EDIT_WINDOW_MS = 30 * 60 * 1000;
const MAX_TAGS = 5;

const STATUS_AUDIT = {
  answered: 'FORUM_POST_REOPEN',
  locked: 'FORUM_POST_LOCK',
  archived: 'FORUM_POST_ARCHIVE',
  open: 'FORUM_POST_REOPEN'
};

/** Forum channel gate: members-only, and the channel must actually be a forum. */
async function loadForumChannel(channelId, userId, capability = CAP.VIEW_CHANNEL) {
  const access = await loadChannelAccess({ channelId, userId, capability });
  if (access.channel.type !== 'forum') {
    throw badRequest('This channel is not a forum.');
  }
  return access;
}

const canManage = (permissions) => permissions.includes(CAP.MANAGE_FORUM_POSTS);

const withinEditWindow = (doc) => Date.now() - new Date(doc.createdAt).getTime() <= EDIT_WINDOW_MS;

// ─── GET /api/communities/:id/channels/:channelId/forum ─────────────────────
const listForumPosts = async (req, res, next) => {
  try {
    const { channel, community } = await loadForumChannel(req.params.channelId, req.user._id);

    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 30 });
    const filter = { channelId: channel._id, communityId: community._id, isDeleted: false };

    if (req.query.status) {
      const status = sanitizeLine(req.query.status, 20).toLowerCase();
      if (!FORUM_STATUSES.includes(status)) throw badRequest('Unknown forum status.');
      filter.status = status;
    }
    if (req.query.tag) {
      filter.tags = sanitizeLine(req.query.tag, 24).toLowerCase();
    }
    if (req.query.q) {
      const q = sanitizeLine(req.query.q, 100);
      if (q.length >= 2) filter.$text = { $search: q };
    }

    const [posts, total] = await Promise.all([
      ForumPost.find(filter)
        .sort({ pinned: -1, lastReplyAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('authorId', 'username level')
        .lean(),
      ForumPost.countDocuments(filter)
    ]);

    res.status(200).json({
      posts: posts.map((post) => ({
        ...post,
        author: post.authorId
          ? { _id: post.authorId._id, username: post.authorId.username, level: post.authorId.level }
          : null,
        authorId: undefined
      })),
      total,
      page,
      hasMore: skip + posts.length < total,
      forumConfig: channel.forumConfig
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/communities/:id/channels/:channelId/forum ────────────────────
const createForumPost = async (req, res, next) => {
  try {
    const { channel, community, role } = await loadForumChannel(
      req.params.channelId, req.user._id, CAP.CREATE_FORUM_POSTS
    );

    if (!roleAtLeast(role, channel.forumConfig?.postCreationRoleMin || 'member')) {
      throw forbidden('Your role cannot create posts in this forum.');
    }

    const title = sanitizeLine(req.body.title, 100);
    const body = sanitizeLine(req.body.body, 4000);
    if (title.length < 4) throw badRequest('Give the post a title of at least 4 characters.');
    if (body.length < 2) throw badRequest('The post body cannot be empty.');

    let tags = normalizeTags(req.body.tags).slice(0, MAX_TAGS);
    const allowed = channel.forumConfig?.allowedTags || [];
    if (allowed.length) {
      const allowedLower = allowed.map((tag) => String(tag).toLowerCase());
      tags = tags.filter((tag) => allowedLower.includes(tag));
    }
    if (channel.forumConfig?.requireTag && !tags.length) {
      throw badRequest('This forum requires at least one tag.');
    }

    const post = await ForumPost.create({
      channelId: channel._id,
      communityId: community._id,
      authorId: req.user._id,
      title,
      body,
      tags
    });

    emitToChannel(channel._id, 'forum_post_created', {
      channelId: String(channel._id),
      postId: String(post._id),
      title: post.title,
      tags: post.tags,
      author: { _id: String(req.user._id), username: req.user.username }
    });

    res.status(201).json({
      ...post.toObject(),
      author: { _id: req.user._id, username: req.user.username, level: req.user.level }
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET .../forum/:postId ──────────────────────────────────────────────────
const getForumPost = async (req, res, next) => {
  try {
    const { channel, community } = await loadForumChannel(req.params.channelId, req.user._id);
    if (!mongoose.Types.ObjectId.isValid(String(req.params.postId))) {
      throw badRequest('Invalid post id');
    }

    const post = await ForumPost.findOne({
      _id: req.params.postId,
      channelId: channel._id,
      communityId: community._id
    }).populate('authorId', 'username level').lean();

    if (!post) throw notFound('Post not found.');

    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 50 });

    const [replies, total] = await Promise.all([
      ForumReply.find({ postId: post._id })
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .populate('authorId', 'username level')
        .lean(),
      ForumReply.countDocuments({ postId: post._id })
    ]);

    res.status(200).json({
      post: {
        ...post,
        author: post.authorId
          ? { _id: post.authorId._id, username: post.authorId.username, level: post.authorId.level }
          : null,
        authorId: undefined
      },
      replies: replies.map((reply) => ({
        ...reply,
        author: reply.authorId
          ? { _id: reply.authorId._id, username: reply.authorId.username, level: reply.authorId.level }
          : null,
        authorId: undefined
      })),
      totalReplies: total,
      page,
      hasMore: skip + replies.length < total
    });
  } catch (err) {
    next(err);
  }
};

// ─── PUT .../forum/:postId ──────────────────────────────────────────────────
const updateForumPost = async (req, res, next) => {
  try {
    const { channel, community, permissions } = await loadForumChannel(
      req.params.channelId, req.user._id
    );

    const post = await ForumPost.findOne({
      _id: req.params.postId,
      channelId: channel._id,
      communityId: community._id,
      isDeleted: false
    });
    if (!post) throw notFound('Post not found.');

    const isAuthor = String(post.authorId) === String(req.user._id);
    if (!isAuthor && !canManage(permissions)) {
      throw forbidden('Only the author or a moderator can edit this post.');
    }
    if (isAuthor && !canManage(permissions) && !withinEditWindow(post)) {
      throw forbidden('Posts can only be edited within 30 minutes of creation.');
    }

    if (req.body.title !== undefined) {
      const title = sanitizeLine(req.body.title, 100);
      if (title.length < 4) throw badRequest('Give the post a title of at least 4 characters.');
      post.title = title;
    }
    if (req.body.body !== undefined) {
      const body = sanitizeLine(req.body.body, 4000);
      if (body.length < 2) throw badRequest('The post body cannot be empty.');
      post.body = body;
    }
    if (req.body.tags !== undefined) {
      post.tags = normalizeTags(req.body.tags).slice(0, MAX_TAGS);
    }

    await post.save();

    emitToChannel(channel._id, 'forum_post_updated', {
      channelId: String(channel._id),
      postId: String(post._id),
      title: post.title,
      tags: post.tags
    });

    res.status(200).json(post);
  } catch (err) {
    next(err);
  }
};

// ─── DELETE .../forum/:postId ───────────────────────────────────────────────
const deleteForumPost = async (req, res, next) => {
  try {
    const { channel, community, permissions } = await loadForumChannel(
      req.params.channelId, req.user._id
    );

    const post = await ForumPost.findOne({
      _id: req.params.postId,
      channelId: channel._id,
      communityId: community._id
    });
    if (!post || post.isDeleted) throw notFound('Post not found.');

    const isAuthor = String(post.authorId) === String(req.user._id);
    if (!isAuthor && !canManage(permissions)) {
      throw forbidden('Only the author or a moderator can delete this post.');
    }

    post.isDeleted = true;
    post.deletedAt = new Date();
    post.deletedBy = req.user._id;
    post.title = 'This post was deleted';
    post.body = 'This post was deleted';
    await post.save();

    if (!isAuthor) {
      recordAudit({
        communityId: community._id,
        actorId: req.user._id,
        actionType: 'FORUM_POST_DELETE',
        targetId: post._id,
        targetModel: 'ForumPost',
        metadata: { channelId: String(channel._id) }
      });
    }

    emitToChannel(channel._id, 'forum_post_deleted', {
      channelId: String(channel._id),
      postId: String(post._id)
    });

    res.status(200).json({ message: 'Post deleted.', postId: String(post._id) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH .../forum/:postId/status ─────────────────────────────────────────
const setForumPostStatus = async (req, res, next) => {
  try {
    const { channel, community } = await loadForumChannel(
      req.params.channelId, req.user._id, CAP.MANAGE_FORUM_POSTS
    );

    const status = sanitizeLine(req.body.status, 20).toLowerCase();
    if (!FORUM_STATUSES.includes(status)) {
      throw badRequest(`Status must be one of: ${FORUM_STATUSES.join(', ')}.`);
    }

    const post = await ForumPost.findOneAndUpdate(
      { _id: req.params.postId, channelId: channel._id, communityId: community._id, isDeleted: false },
      { $set: { status } },
      { new: true }
    );
    if (!post) throw notFound('Post not found.');

    recordAudit({
      communityId: community._id,
      actorId: req.user._id,
      actionType: STATUS_AUDIT[status] || 'SETTINGS_UPDATE',
      targetId: post._id,
      targetModel: 'ForumPost',
      metadata: { status, channelId: String(channel._id) }
    });

    emitToChannel(channel._id, 'forum_post_updated', {
      channelId: String(channel._id),
      postId: String(post._id),
      status: post.status
    });

    res.status(200).json({ postId: String(post._id), status: post.status });
  } catch (err) {
    next(err);
  }
};

// ─── POST .../forum/:postId/replies ─────────────────────────────────────────
const createForumReply = async (req, res, next) => {
  try {
    const { channel, community, role } = await loadForumChannel(
      req.params.channelId, req.user._id, CAP.REPLY_FORUM_POSTS
    );

    if (!roleAtLeast(role, channel.forumConfig?.replyRoleMin || 'member')) {
      throw forbidden('Your role cannot reply in this forum.');
    }

    const post = await ForumPost.findOne({
      _id: req.params.postId,
      channelId: channel._id,
      communityId: community._id,
      isDeleted: false
    }).lean();
    if (!post) throw notFound('Post not found.');
    if (post.status !== 'open' && post.status !== 'answered') {
      throw forbidden('This post is locked. Replies are closed.');
    }

    const body = sanitizeLine(req.body.body, 2000);
    if (body.length < 1) throw badRequest('The reply cannot be empty.');

    const reply = await ForumReply.create({
      postId: post._id,
      channelId: channel._id,
      communityId: community._id,
      authorId: req.user._id,
      body
    });

    await ForumPost.updateOne(
      { _id: post._id },
      { $inc: { replyCount: 1 }, $set: { lastReplyAt: new Date() } }
    );

    emitToChannel(channel._id, 'forum_reply_created', {
      channelId: String(channel._id),
      postId: String(post._id),
      replyId: String(reply._id),
      replyCount: post.replyCount + 1
    });

    res.status(201).json({
      ...reply.toObject(),
      author: { _id: req.user._id, username: req.user.username, level: req.user.level }
    });
  } catch (err) {
    next(err);
  }
};

// ─── PUT / DELETE .../forum/:postId/replies/:replyId ────────────────────────
const updateForumReply = async (req, res, next) => {
  try {
    const { channel, community } = await loadForumChannel(req.params.channelId, req.user._id);

    const reply = await ForumReply.findOne({
      _id: req.params.replyId,
      postId: req.params.postId,
      channelId: channel._id,
      communityId: community._id,
      isDeleted: false
    });
    if (!reply) throw notFound('Reply not found.');
    if (String(reply.authorId) !== String(req.user._id)) {
      throw forbidden('Only the author can edit this reply.');
    }
    if (!withinEditWindow(reply)) {
      throw forbidden('Replies can only be edited within 30 minutes of posting.');
    }

    const body = sanitizeLine(req.body.body, 2000);
    if (body.length < 1) throw badRequest('The reply cannot be empty.');

    reply.body = body;
    reply.isEdited = true;
    await reply.save();

    emitToChannel(channel._id, 'forum_reply_updated', {
      channelId: String(channel._id),
      postId: String(req.params.postId),
      replyId: String(reply._id),
      body: reply.body
    });

    res.status(200).json(reply);
  } catch (err) {
    next(err);
  }
};

const deleteForumReply = async (req, res, next) => {
  try {
    const { channel, community, permissions } = await loadForumChannel(req.params.channelId, req.user._id);

    const reply = await ForumReply.findOne({
      _id: req.params.replyId,
      postId: req.params.postId,
      channelId: channel._id,
      communityId: community._id
    });
    if (!reply || reply.isDeleted) throw notFound('Reply not found.');

    const isAuthor = String(reply.authorId) === String(req.user._id);
    if (!isAuthor && !canManage(permissions)) {
      throw forbidden('Only the author or a moderator can delete this reply.');
    }

    reply.isDeleted = true;
    reply.deletedAt = new Date();
    reply.body = 'This reply was deleted';
    await reply.save();

    await ForumPost.updateOne(
      { _id: reply.postId, replyCount: { $gt: 0 } },
      { $inc: { replyCount: -1 } }
    );

    emitToChannel(channel._id, 'forum_reply_deleted', {
      channelId: String(channel._id),
      postId: String(reply.postId),
      replyId: String(reply._id)
    });

    res.status(200).json({ message: 'Reply deleted.', replyId: String(reply._id) });
  } catch (err) {
    next(err);
  }
};

/**
 * Forum channels do not use the live message stream. The socket refuses to
 * deliver into them, and the REST history endpoint returns this marker so the
 * client knows to render the forum surface instead.
 */
const assertNotForum = async (channelId) => {
  if (!mongoose.Types.ObjectId.isValid(String(channelId))) return;
  const channel = await Channel.findById(channelId).select('type').lean();
  return channel?.type === 'forum';
};

module.exports = {
  listForumPosts,
  createForumPost,
  getForumPost,
  updateForumPost,
  deleteForumPost,
  setForumPostStatus,
  createForumReply,
  updateForumReply,
  deleteForumReply,
  assertNotForum
};
