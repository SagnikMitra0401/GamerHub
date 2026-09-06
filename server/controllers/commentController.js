const mongoose = require('mongoose');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const { awardXp } = require('../utils/gamification');

const createComment = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const { text } = req.body;

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ message: 'Invalid post id' });
    }
    if (!text || !text.trim()) {
      return res.status(400).json({ message: 'Comment text required' });
    }

    const postExists = await Post.exists({ _id: postId });
    if (!postExists) return res.status(404).json({ message: 'Post not found' });

    const comment = await Comment.create({ postId, userId: req.user._id, text });
    await Post.findByIdAndUpdate(postId, { $inc: { commentCount: 1 } });

    // Gamification: award +5 XP and Gamer Critic medal for commenting (non-blocking)
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
    const { page = 1, limit = 30 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ message: 'Invalid post id' });
    }

    const comments = await Comment.find({ postId })
      .sort({ createdAt: 1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Math.min(Number(limit), 100))
      .populate('userId', 'username')
      .lean();

    res.status(200).json(comments);
  } catch (err) {
    next(err);
  }
};

const updateComment = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ message: 'Comment text required' });
    }
    req.resource.text = text;
    await req.resource.save();
    res.status(200).json(req.resource);
  } catch (err) {
    next(err);
  }
};

const deleteComment = async (req, res, next) => {
  try {
    await Post.findByIdAndUpdate(req.resource.postId, { $inc: { commentCount: -1 } });
    await req.resource.deleteOne();
    res.status(200).json({ message: 'Comment deleted' });
  } catch (err) {
    next(err);
  }
};

module.exports = { createComment, getCommentsForPost, updateComment, deleteComment };
