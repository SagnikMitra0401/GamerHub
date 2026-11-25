const mongoose = require('mongoose');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const { awardXp } = require('../utils/gamification');
const { sanitizeText } = require('../utils/sanitize');
const { parsePagination } = require('../utils/pagination');
const { badRequest, notFound } = require('../utils/httpError');
const { notifyPostComment } = require('../utils/socialNotifications');
const { recordFirstEvent } = require('../utils/productEvents');

const MAX_COMMENT = 2000;

const createComment = async (req, res, next) => {
  try {
    const { postId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(postId)) throw badRequest('Invalid post id');

    const text = sanitizeText(req.body.text, MAX_COMMENT);
    if (!text) throw badRequest('Comment text required');

    const post = await Post.findById(postId)
      .select('userId hiddenAt')
      .populate('userId', 'status')
      .lean();
    if (!post) throw notFound('Post not found');
    if (post.hiddenAt) throw notFound('Post not found');
    if (['frozen', 'suspended', 'deleted'].includes(post.userId?.status))
      throw notFound('Post not found');

    const comment = await Comment.create({ postId, userId: req.user._id, text });
    recordFirstEvent('first_comment', req.user._id, { surface: 'post' });
    await Post.findByIdAndUpdate(postId, { $inc: { commentCount: 1 } });

    // The author is the only recipient. Self-comments, blocked pairs and a
    // switched-off comments preference are handled by notifyUser.
    await notifyPostComment({ post, comment, actor: req.user });

    awardXp(req.user._id, 5, 'gamer_critic');

    const populated = await comment.populate('userId', 'username level role profileType');
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
};

const getCommentsForPost = async (req, res, next) => {
  try {
    const { postId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(postId)) throw badRequest('Invalid post id');

    // A frozen author's post is not readable, so neither is its comment thread.
    const post = await Post.findById(postId)
      .select('userId hiddenAt')
      .populate('userId', 'status')
      .lean();
    if (!post) throw notFound('Post not found');
    if (post.hiddenAt) throw notFound('Post not found');
    if (
      ['frozen', 'suspended', 'deleted'].includes(post.userId?.status) &&
      String(req.user?._id) !== String(post.userId._id)
    ) {
      throw notFound('Post not found');
    }

    const { skip, limit } = parsePagination(req.query, { defaultLimit: 30, maxLimit: 100 });

    const comments = await Comment.find({ postId, hiddenAt: null })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'username')
      .lean();

    res.status(200).json(comments);
  } catch (err) {
    next(err);
  }
};

const updateComment = async (req, res, next) => {
  try {
    const text = sanitizeText(req.body.text, MAX_COMMENT);
    if (!text) throw badRequest('Comment text required');

    req.resource.text = text;
    await req.resource.save();
    res.status(200).json(req.resource);
  } catch (err) {
    next(err);
  }
};

const deleteComment = async (req, res, next) => {
  try {
    // Only decrement when the counter is positive, so it can never go negative.
    await Post.updateOne(
      { _id: req.resource.postId, commentCount: { $gt: 0 } },
      { $inc: { commentCount: -1 } },
    );
    await req.resource.deleteOne();
    res.status(200).json({ message: 'Comment deleted' });
  } catch (err) {
    next(err);
  }
};

module.exports = { createComment, getCommentsForPost, updateComment, deleteComment };
