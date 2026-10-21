const mongoose = require('mongoose');
const fs = require('fs');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const User = require('../models/User');
const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');
const { scrapePreview, normaliseUrl } = require('../utils/scrapePreview');
const { awardXp } = require('../utils/gamification');
const { sanitizeLine, sanitizeText, sanitizeLinkPreview, normalizeTags } = require('../utils/sanitize');
const { parsePagination } = require('../utils/pagination');
const { badRequest, forbidden, notFound } = require('../utils/httpError');

const EDIT_LIMIT_MS = 5 * 60 * 1000;
const MAX_TITLE = 150;
const MAX_CONTENT = 10_000;

const cleanupTempFile = (path) => {
  if (path) fs.unlink(path, () => {});
};

const createPost = async (req, res, next) => {
  let tempFilePath = null;
  try {
    const title = sanitizeLine(req.body.title, MAX_TITLE);
    const content = sanitizeText(req.body.content, MAX_CONTENT);
    const tags = normalizeTags(req.body.tags);

    // Media fields are server-derived only — never read them from the body.
    let mediaUrl = null;
    let mediaType = 'none';
    let mediaPublicId = null;

    if (!title) throw badRequest('A title is required.');

    if (req.file) {
      tempFilePath = req.file.path;
      const isVideo = req.file.mimetype.startsWith('video/');
      const maxAllowedSize = isVideo ? 10 * 1024 * 1024 : 5 * 1024 * 1024;

      if (req.file.size > maxAllowedSize) {
        // Multer accepted it (10MB cap) but the type-specific limit is smaller:
        // remove the temp file before bailing out.
        cleanupTempFile(tempFilePath);
        tempFilePath = null;
        throw badRequest(isVideo ? 'Videos must be 10MB or less.' : 'Images must be 5MB or less.');
      }

      const cloudinaryResult = await uploadToCloudinary(tempFilePath);
      mediaUrl = cloudinaryResult.secure_url;
      mediaType = isVideo ? 'video' : 'image';
      mediaPublicId = cloudinaryResult.public_id;

      cleanupTempFile(tempFilePath);
      tempFilePath = null;
    }

    // Link preview: only accept a well-formed http(s) payload from the client,
    // otherwise scrape server-side.
    let linkPreview = null;
    if (req.body.linkPreview) {
      try {
        linkPreview = sanitizeLinkPreview(JSON.parse(req.body.linkPreview));
      } catch {
        linkPreview = null;
      }
    }
    if (!linkPreview) {
      const searchText = [title, content].filter(Boolean).join(' ');
      linkPreview = sanitizeLinkPreview(await scrapePreview(searchText, 5000));
    }

    const post = await Post.create({
      userId: req.user._id,
      title,
      content,
      tags,
      mediaUrl,
      mediaType,
      mediaPublicId,
      linkPreview: linkPreview || {}
    });

    const isMediaPost = !!post.mediaUrl;
    awardXp(req.user._id, isMediaPost ? 10 : 5, isMediaPost ? 'highlight_poster' : null);

    const populatedPost = await Post.findById(post._id).populate('userId', 'username level role');
    res.status(201).json(populatedPost);
  } catch (err) {
    cleanupTempFile(tempFilePath);
    next(err);
  }
};

/** Feed aggregation — the author projection is explicit, never a full user doc. */
const getPosts = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 15, maxLimit: 50 });

    const matchStage = {};

    const tag = sanitizeLine(req.query.channel, 24).toLowerCase();
    if (tag) matchStage.tags = tag;

    if (req.query.feed === 'following') {
      const following = req.user?.following ?? [];
      if (!following.length) return res.status(200).json([]);
      matchStage.userId = { $in: following };
    }

    const favChannels = (req.user?.favoriteChannels ?? [])
      .filter((t) => typeof t === 'string' && t.length <= 24)
      .slice(0, 50);

    const addFieldsStage = {
      likeCount: { $size: '$likes' },
      boostScore: favChannels.length
        ? {
            $cond: {
              if: { $gt: [{ $size: { $setIntersection: ['$tags', favChannels] } }, 0] },
              then: 1000,
              else: 0
            }
          }
        : { $literal: 0 }
    };

    const sortStage = req.query.sort === 'most_liked'
      ? { boostScore: -1, likeCount: -1, createdAt: -1 }
      : { boostScore: -1, createdAt: -1 };

    const posts = await Post.aggregate([
      { $match: matchStage },
      { $addFields: addFieldsStage },
      { $sort: sortStage },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          let: { authorId: '$userId' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$authorId'] } } },
            // ⚠️ Never widen this projection: emails and password hashes must
            // never be reachable from an unauthenticated feed request.
            { $project: { _id: 1, username: 1, level: 1, role: 1 } }
          ],
          as: 'author'
        }
      },
      { $unwind: '$author' },
      {
        $project: {
          userId: '$author',
          title: 1,
          content: 1,
          tags: 1,
          likes: 1,
          commentCount: 1,
          mediaUrl: 1,
          mediaType: 1,
          linkPreview: 1,
          createdAt: 1,
          updatedAt: 1,
          likeCount: 1
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
    if (!mongoose.Types.ObjectId.isValid(id)) throw badRequest('Invalid post id');

    const post = await Post.findById(id)
      .populate('userId', 'username level role')
      .lean({ virtuals: true });
    if (!post) throw notFound('Post not found');

    res.status(200).json(post);
  } catch (err) {
    next(err);
  }
};

// req.resource attached by checkOwnership middleware
const updatePost = async (req, res, next) => {
  try {
    const timeElapsed = Date.now() - new Date(req.resource.createdAt).getTime();
    if (timeElapsed > EDIT_LIMIT_MS) {
      throw forbidden('Editing is only allowed up to 5 minutes after posting.');
    }

    const updates = {};
    if (req.body.title !== undefined) {
      const title = sanitizeLine(req.body.title, MAX_TITLE);
      if (!title) throw badRequest('A title is required.');
      updates.title = title;
    }
    if (req.body.content !== undefined) {
      updates.content = sanitizeText(req.body.content, MAX_CONTENT);
    }
    if (req.body.tags !== undefined) {
      updates.tags = normalizeTags(req.body.tags);
    }

    if (!Object.keys(updates).length) throw badRequest('No updatable fields provided.');

    if (updates.title !== undefined || updates.content !== undefined) {
      const title = updates.title ?? req.resource.title;
      const content = updates.content ?? req.resource.content;
      const preview = sanitizeLinkPreview(await scrapePreview([title, content].join(' '), 4000));
      updates.linkPreview = preview || { url: null, title: null, description: null, image: null, siteName: null };
    }

    Object.assign(req.resource, updates);
    await req.resource.save();
    res.status(200).json(req.resource);
  } catch (err) {
    next(err);
  }
};

const deletePost = async (req, res, next) => {
  try {
    if (req.resource.mediaPublicId) {
      await deleteFromCloudinary(
        req.resource.mediaPublicId,
        req.resource.mediaType === 'video' ? 'video' : 'image'
      ).catch((err) => {
        console.error('Failed to delete asset from Cloudinary:', err.message);
      });
    }

    await Comment.deleteMany({ postId: req.resource._id });
    await User.updateMany(
      { savedPosts: req.resource._id },
      { $pull: { savedPosts: req.resource._id } }
    );
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

    if (!mongoose.Types.ObjectId.isValid(id)) throw badRequest('Invalid post id');

    const alreadyLiked = await Post.exists({ _id: id, likes: userId });

    const update = alreadyLiked
      ? { $pull: { likes: userId } }
      : { $addToSet: { likes: userId } };

    const post = await Post.findByIdAndUpdate(id, update, { new: true });
    if (!post) throw notFound('Post not found');

    if (!alreadyLiked && post.likes.length === 10) {
      awardXp(post.userId, 50, 'viral_gamer');
    }

    res.status(200).json({ likeCount: post.likes.length, liked: !alreadyLiked });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/posts/preview?url=<any-url>
 * Authenticated + rate limited; outbound fetches are SSRF-guarded.
 */
const previewLink = async (req, res, next) => {
  try {
    const raw = String(req.query.url || '').trim();
    if (!raw) throw badRequest('url query parameter is required');
    if (raw.length > 2048) throw badRequest('URL is too long');

    const url = normaliseUrl(raw);
    if (!url) throw badRequest('Invalid URL');

    const preview = await scrapePreview(url, 5000);
    if (!preview) {
      return res.status(422).json({ message: 'No preview data found for this URL' });
    }
    return res.status(200).json(preview);
  } catch (err) {
    if (err.statusCode) return next(err);
    return next(badRequest('Failed to fetch preview'));
  }
};

module.exports = { createPost, getPosts, getPostById, updatePost, deletePost, toggleLike, previewLink };
