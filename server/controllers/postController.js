const mongoose = require('mongoose');
const fs = require('fs');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');
const scrapePreview = require('../utils/scrapePreview');
const { awardXp } = require('../utils/gamification');

const ALLOWED_FIELDS = ['title', 'content', 'tags'];

const sanitizeBody = (body) => {
  const clean = {};
  for (const key of ALLOWED_FIELDS) {
    if (body[key] !== undefined) clean[key] = body[key];
  }
  return clean;
};

const createPost = async (req, res, next) => {
  let tempFilePath = null;
  try {
    const data = sanitizeBody(req.body);

    // Handle tag parsing if tags are sent as a string (common with multipart/form-data)
    if (typeof req.body.tags === 'string') {
      try {
        data.tags = JSON.parse(req.body.tags);
      } catch (e) {
        data.tags = req.body.tags.split(',').map(t => t.trim()).filter(Boolean);
      }
    }

    if (req.file) {
      tempFilePath = req.file.path;
      const isVideo = req.file.mimetype.startsWith('video/');
      const maxAllowedSize = isVideo ? 10 * 1024 * 1024 : 5 * 1024 * 1024;

      if (req.file.size > maxAllowedSize) {
        return res.status(400).json({
          message: isVideo ? 'Videos must be 10MB or less.' : 'Images must be 5MB or less.'
        });
      }

      // Upload to Cloudinary
      const cloudinaryResult = await uploadToCloudinary(tempFilePath);
      data.mediaUrl = cloudinaryResult.secure_url;
      data.mediaType = isVideo ? 'video' : 'image';
      data.mediaPublicId = cloudinaryResult.public_id;

      // Clean up temp file
      fs.unlink(tempFilePath, () => {});
      tempFilePath = null;
    }

    // Scrape link preview if a link exists in content or title
    const preview = await scrapePreview(data.content || data.title);
    if (preview) {
      data.linkPreview = preview;
    }

    const post = await Post.create({ ...data, userId: req.user._id });
    
    // Gamification: award XP based on post type (non-blocking)
    const isMediaPost = !!(data.mediaUrl);
    awardXp(
      req.user._id,
      isMediaPost ? 10 : 5,
      isMediaPost ? 'highlight_poster' : null
    );

    // Return populated post
    const populatedPost = await Post.findById(post._id).populate('userId', 'username level role');
    res.status(201).json(populatedPost);
  } catch (err) {
    if (tempFilePath) {
      fs.unlink(tempFilePath, () => {});
    }
    next(err);
  }
};

const getPosts = async (req, res, next) => {
  try {
    const { channel, page = 1, limit = 15, sort = 'latest', feed } = req.query;

    const pageNum  = Math.max(1, Number(page));
    const limitNum = Math.min(Math.max(1, Number(limit)), 50);

    const matchStage = {};

    // Channel filter — posts tagged with a specific tag
    if (channel) matchStage.tags = channel.toLowerCase();

    // Following feed — posts only from users the caller follows
    if (feed === 'following' && req.user?.following?.length) {
      matchStage.userId = { $in: req.user.following };
    } else if (feed === 'following') {
      // User follows nobody — return empty
      return res.status(200).json([]);
    }

    // Favourite channels boost: posts with overlapping tags get +1000 to sort score
    const favChannels = req.user?.favoriteChannels ?? [];

    const addFieldsStage = {
      likeCount: { $size: '$likes' },
      boostScore: favChannels.length
        ? {
            $cond: {
              if: {
                $gt: [
                  { $size: { $setIntersection: ['$tags', favChannels] } },
                  0
                ]
              },
              then: 1000,
              else: 0
            }
          }
        : { $literal: 0 }
    };

    const sortStage = sort === 'most_liked'
      ? { boostScore: -1, likeCount: -1, createdAt: -1 }
      : { boostScore: -1, createdAt: -1 };

    const posts = await Post.aggregate([
      { $match: matchStage },
      { $addFields: addFieldsStage },
      { $sort: sortStage },
      { $skip: (pageNum - 1) * limitNum },
      { $limit: limitNum },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'userId'
        }
      },
      { $unwind: '$userId' },
      {
        $set: {
          userId: {
            _id:      '$userId._id',
            username: '$userId.username',
            level:    '$userId.level',
            role:     '$userId.role'
          }
        }
      }
    ]);

    res.status(200).json(posts);
  } catch (err) {
    next(err);
  }
};


const getPostById = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid post id' });
    }
    const post = await Post.findById(id).populate('userId', 'username').lean({ virtuals: true });
    if (!post) return res.status(404).json({ message: 'Post not found' });
    res.status(200).json(post);
  } catch (err) {
    next(err);
  }
};

// req.resource attached by checkOwnership middleware
const updatePost = async (req, res, next) => {
  try {
    // Editing rule: only allowed up to 5 minutes (300,000 ms) after creation
    const EDIT_LIMIT_MS = 5 * 60 * 1000;
    const timeElapsed = Date.now() - new Date(req.resource.createdAt).getTime();
    if (timeElapsed > EDIT_LIMIT_MS) {
      return res.status(403).json({
        message: 'Editing is only allowed up to 5 minutes after posting.'
      });
    }

    const data = sanitizeBody(req.body);

    // If tags are stringified (coming from frontend updates)
    if (typeof req.body.tags === 'string') {
      try {
        data.tags = JSON.parse(req.body.tags);
      } catch (e) {
        data.tags = req.body.tags.split(',').map(t => t.trim()).filter(Boolean);
      }
    }

    // Scrape/update link preview if text changes
    if (data.content !== undefined || data.title !== undefined) {
      const textToScrape = (data.content !== undefined ? data.content : req.resource.content) || 
                           (data.title !== undefined ? data.title : req.resource.title);
      const preview = await scrapePreview(textToScrape);
      data.linkPreview = preview || { url: null, title: null, description: null, image: null };
    }

    Object.assign(req.resource, data);
    await req.resource.save();
    res.status(200).json(req.resource);
  } catch (err) {
    next(err);
  }
};

const deletePost = async (req, res, next) => {
  try {
    // Delete file from Cloudinary if media exists
    if (req.resource.mediaPublicId) {
      await deleteFromCloudinary(
        req.resource.mediaPublicId, 
        req.resource.mediaType === 'video' ? 'video' : 'image'
      ).catch(err => {
        // Log error but don't block DB deletion if Cloudinary fails (e.g. file already deleted manually)
        console.error('Failed to delete asset from Cloudinary:', err.message);
      });
    }

    await Comment.deleteMany({ postId: req.resource._id });
    await req.resource.deleteOne();
    res.status(200).json({ message: 'Post deleted' });
  } catch (err) {
    next(err);
  }
};

// Atomic toggle — no ownership check required, self-contained authorization
const toggleLike = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid post id' });
    }

    const alreadyLiked = await Post.exists({ _id: id, likes: userId });

    const update = alreadyLiked
      ? { $pull: { likes: userId } }
      : { $addToSet: { likes: userId } };

    const post = await Post.findByIdAndUpdate(id, update, { new: true });
    if (!post) return res.status(404).json({ message: 'Post not found' });

    // Gamification: award Viral Gamer medal when post hits exactly 10 likes
    if (!alreadyLiked && post.likes.length === 10) {
      awardXp(post.userId, 50, 'viral_gamer');
    }

    res.status(200).json({ likeCount: post.likes.length, liked: !alreadyLiked });
  } catch (err) {
    next(err);
  }
};

module.exports = { createPost, getPosts, getPostById, updatePost, deletePost, toggleLike };
