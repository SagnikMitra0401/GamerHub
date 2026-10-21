const mongoose = require('mongoose');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const { awardXp } = require('../utils/gamification');
const { sanitizeText } = require('../utils/sanitize');
const { parsePagination } = require('../utils/pagination');
const { badRequest, notFound } = require('../utils/httpError');

const MAX_COMMENT = 2000;

const createComment = async (req, res, next) => {
  try {
    const { postId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(postId)) throw badRequest('Invalid post id');

    const text = sanitizeText(req.body.text, MAX_COMMENT);
    if (!text) throw badRequest('Comment text required');

    const postExists = await Post.exists({ _id: postId });
    if (!postExists) throw notFound('Post not found');

    const comment = await Comment.create({ postId, userId: req.user._id, text });
    await Post.findByIdAndUpdate(postId, { $inc: { commentCount: 1 } });

    awardXp(req.user._id, 5, 'gamer_critic');

    const populated = await comment.populate('userId', 'username level role');
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
};

const getCommentsForPost = async (req, res, next) => {
  try {
    const { postId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(postId)) throw badRequest('Invalid post id');

    const { skip, limit } = parsePagination(req.query, { defaultLimit: 30, maxLimit: 100 });

    const comments = await Comment.find({ postId })
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
      { $inc: { commentCount: -1 } }
    );
    await req.resource.deleteOne();
    res.status(200).json({ message: 'Comment deleted' });
  } catch (err) {
    next(err);
  }
};

module.exports = { createComment, getCommentsForPost, updateComment, deleteComment };
