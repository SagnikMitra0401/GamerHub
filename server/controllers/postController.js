const mongoose = require('mongoose');
const fs = require('fs');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const User = require('../models/User');
const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');
const MediaAsset = require('../models/MediaAsset');
const { storeImageBuffer, registerVideoAsset, linkMediaAsset } = require('../utils/mediaPipeline');
const { mediaPublicId: buildMediaPublicId } = require('../utils/mediaPaths');
const { scrapePreview, normaliseUrl } = require('../utils/scrapePreview');
const { awardXp } = require('../utils/gamification');
const { recordFirstEvent } = require('../utils/productEvents');
const {
  sanitizeLine, sanitizeText, sanitizeLinkPreview, normalizeTags, extractHashtags, escapeRegex
} = require('../utils/sanitize');
const { parsePagination } = require('../utils/pagination');
const { badRequest, forbidden, notFound } = require('../utils/httpError');
const { rankPostsForUser } = require('../utils/feedRanking');
const { bufferLikeEvent, readPendingLike, likePipeline } = require('../utils/likeBuffer');
const { notifyLikeMilestone } = require('../utils/socialNotifications');
const { parseYouTubeId, findYouTubeIdInText, normalizeDuration } = require('../utils/videoSource');
const { blockedIdsFor } = require('../utils/visibility');

// "For You" ranks this many recent posts in memory, then paginates the ranking.
const FOR_YOU_POOL = 100;

const EDIT_LIMIT_MS = 5 * 60 * 1000;
const MAX_TITLE = 150;
const MAX_CONTENT = 10_000;

const cleanupTempFile = (path) => {
  if (path) fs.unlink(path, () => {});
};

/**
 * Tags come from two places: the explicit tag field and inline #hashtags in
 * the title/body. Both normalise to the same stored form and dedupe together.
 */
const collectTags = (rawTags, ...texts) =>
  normalizeTags([...normalizeTags(rawTags), ...extractHashtags(...texts)]);

const createPost = async (req, res, next) => {
  let tempFilePath = null;
  try {
    const title = sanitizeLine(req.body.title, MAX_TITLE);
    const content = sanitizeText(req.body.content, MAX_CONTENT);
    const tags = collectTags(req.body.tags, title, content);

    // Media fields are server-derived only — never read them from the body.
    let mediaUrl = null;
    let mediaCardUrl = null;
    let mediaType = 'none';
    let mediaPublicId = null;
    let mediaAssetId = null;
    let durationSeconds = null;

    if (!title) throw badRequest('A title is required.');

    if (req.file) {
      tempFilePath = req.file.path;
      const isVideo = req.file.mimetype.startsWith('video/');
      // Videos reach the Cloudinary free-tier ceiling; images stay small
      // because they are re-encoded locally before upload.
      const maxAllowedSize = isVideo ? 100 * 1024 * 1024 : 5 * 1024 * 1024;

      if (req.file.size > maxAllowedSize) {
        // Multer accepted it (100MB cap) but the type-specific limit is smaller:
        // remove the temp file before bailing out.
        cleanupTempFile(tempFilePath);
        tempFilePath = null;
        throw badRequest(isVideo ? 'Videos must be 100MB or less.' : 'Images must be 5MB or less.');
      }

      if (isVideo) {
        // Video keeps the streamed helper but adopts the new folder scheme.
        const publicId = buildMediaPublicId({ surface: 'post', ownerId: req.user._id });
        const result = await uploadToCloudinary(tempFilePath, { publicId, resourceType: 'video' });
        const asset = await registerVideoAsset({ result, ownerId: req.user._id, surface: 'post' });
        mediaUrl = asset.derivatives.video || result.secure_url;
        mediaType = 'video';
        mediaPublicId = result.public_id;
        mediaAssetId = asset._id;
        durationSeconds = normalizeDuration(req.body.durationSeconds);
      } else {
        // Images are validated, EXIF-stripped, dimension-capped and recorded in
        // the shared media ledger before the post exists.
        const buffer = await fs.promises.readFile(tempFilePath);
        const { asset, result } = await storeImageBuffer({
          buffer,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          surface: 'post',
          ownerId: req.user._id
        });
        mediaUrl = asset.derivatives.full || result.secure_url;
        mediaCardUrl = asset.derivatives.card;
        mediaType = 'image';
        mediaPublicId = result.public_id;
        mediaAssetId = asset._id;
      }

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

    // YouTube is never downloaded: the post embeds the linked video, and the id
    // is re-derived here from the scraped URL (or the body text) so a client
    // cannot point the embed at an unrelated video.
    const youtubeId = parseYouTubeId(linkPreview?.url)
      || findYouTubeIdInText(`${title} ${content}`)
      || null;
    const videoSource = mediaType === 'video' ? 'upload' : youtubeId ? 'youtube' : null;

    const post = await Post.create({
      userId: req.user._id,
      title,
      content,
      tags,
      mediaUrl,
      mediaCardUrl,
      mediaType,
      mediaPublicId,
      mediaAssetId,
      videoSource,
      youtubeId,
      durationSeconds,
      linkPreview: linkPreview || {}
    });

    if (mediaAssetId) {
      await linkMediaAsset(mediaAssetId, { refType: 'Post', refId: post._id });
    }

    const isMediaPost = !!post.mediaUrl;
    recordFirstEvent('first_post', req.user._id, { media: isMediaPost });
    awardXp(req.user._id, isMediaPost ? 10 : 5, isMediaPost ? 'highlight_poster' : null);

    const populatedPost = await Post.findById(post._id).populate('userId', 'username level role profileType');
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

    // Personalized ranking needs a signed-in viewer; anonymous falls back to latest.
    const forYou = req.query.sort === 'foryou' && !!req.user;

    const matchStage = { hiddenAt: null };

    const tag = sanitizeLine(req.query.channel, 24).toLowerCase();
    if (tag) matchStage.tags = tag;

    // Reels and the clips grid ask for video rows only; anything else is a
    // normal feed request and stays unfiltered.
    const mediaType = String(req.query.mediaType || '').toLowerCase();
    if (mediaType === 'video' || mediaType === 'image') matchStage.mediaType = mediaType;

    if (req.query.feed === 'following') {
      const following = req.user?.following ?? [];
      if (!following.length) return res.status(200).json([]);
      matchStage.userId = { $in: following };
    }

    const favChannels = (req.user?.favoriteChannels ?? [])
      .filter((t) => typeof t === 'string' && t.length <= 24)
      .slice(0, 50);

    const addFieldsStage = {
      // Stored counter is authoritative; $size only covers documents written
      // before the denormalisation migration ran.
      likeCount: { $ifNull: ['$likeCount', { $size: '$likes' }] },
      // Engagement over recency: a comment counts double because it costs more
      // than a like. Clips use this to surface the busy ones first.
      trendScore: {
        $add: [
          { $ifNull: ['$likeCount', { $size: '$likes' }] },
          { $multiply: [{ $ifNull: ['$commentCount', 0] }, 2] }
        ]
      },
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

    const sortStage = forYou
      ? { createdAt: -1 }
      : req.query.sort === 'most_liked'
        ? { boostScore: -1, likeCount: -1, createdAt: -1 }
        : req.query.sort === 'trending'
          ? { boostScore: -1, trendScore: -1, createdAt: -1 }
          : { boostScore: -1, createdAt: -1 };

    // Frozen, suspended and deleted authors disappear from other people's
    // feeds; a symmetric block removes both directions too. The filter lives
    // inside the lookup so the emitted author stays minimal.
    const viewerId = req.user?._id || null;
    const blockedIds = await blockedIdsFor(viewerId);
    const authorVisible = {
      // A frozen account can still see its own posts while it is on a break.
      ...(viewerId
        ? { $or: [{ status: { $nin: ['frozen', 'suspended', 'deleted'] } }, { _id: viewerId }] }
        : { status: { $nin: ['frozen', 'suspended', 'deleted'] } }),
      ...(blockedIds.length ? { _id: { $nin: blockedIds } } : {})
    };

    const posts = await Post.aggregate([
      { $match: matchStage },
      { $addFields: addFieldsStage },
      { $sort: sortStage },
      ...(forYou ? [{ $limit: FOR_YOU_POOL }] : [{ $skip: skip }, { $limit: limit }]),
      {
        $lookup: {
          from: 'users',
          let: { authorId: '$userId' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$_id', '$$authorId'] },
                ...authorVisible
              }
            },
            // ⚠️ Never widen this projection: emails and password hashes must
            // never be reachable from an unauthenticated feed request.
            { $project: { _id: 1, username: 1, level: 1, role: 1, profileType: 1 } }
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
          mediaCardUrl: 1,
          mediaType: 1,
          videoSource: 1,
          youtubeId: 1,
          durationSeconds: 1,
          linkPreview: 1,
          createdAt: 1,
          updatedAt: 1,
          likeCount: 1
        }
      }
    ]);

    if (forYou) {
      const prefs = await User.findById(req.user._id)
        .select('preferences favoriteChannels')
        .lean();

      const ranked = rankPostsForUser(posts, {
        favoriteGames: prefs?.preferences?.favoriteGames || [],
        favoriteGenres: prefs?.preferences?.favoriteGenres || [],
        favoriteChannels: prefs?.favoriteChannels || [],
        following: req.user.following || []
      });

      return res.status(200).json(ranked.slice(skip, skip + limit));
    }

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
      .populate('userId', 'username level role profileType status blockedUsers')
      .lean({ virtuals: true });
    if (!post) throw notFound('Post not found');

    const viewerId = String(req.user?._id || '');
    const author = post.userId;
    const blocked = Boolean(viewerId && author) && (
      (req.user?.blockedUsers || []).some((entry) => String(entry) === String(author._id))
      || (author.blockedUsers || []).some((entry) => String(entry) === viewerId)
    );
    if (blocked) throw notFound('Post not found');

    // Same rule as the feed: hidden from everybody except its author.
    if (['frozen', 'suspended', 'deleted'].includes(author?.status)
      && String(author?._id) !== viewerId) {
      throw notFound('Post not found');
    }
    if (post.hiddenAt && req.user?.role !== 'admin') throw notFound('Post not found');

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
    // Tags follow the text: a new inline #hashtag is added on edit. Existing
    // tags are kept unless the caller replaced the tag field explicitly.
    if (req.body.tags !== undefined || updates.title !== undefined || updates.content !== undefined) {
      const title = updates.title ?? req.resource.title;
      const content = updates.content ?? req.resource.content;
      const baseTags = req.body.tags !== undefined ? normalizeTags(req.body.tags) : req.resource.tags;
      updates.tags = normalizeTags([...baseTags, ...extractHashtags(title, content)]);
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
    if (req.resource.mediaAssetId) {
      await MediaAsset.deleteOne({ _id: req.resource.mediaAssetId }).catch(() => {});
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

// Toggle like — no ownership check required, self-contained authorization.
//
// With Redis configured the toggle is queued and answered optimistically; the
// flush worker folds queued toggles into one bulkWrite every few seconds. The
// pending action is read back first, so like → unlike inside one flush window
// still resolves to the state the user sees. Without Redis (local dev, tests,
// Upstash outage) this is the same direct write as before.
const toggleLike = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) throw badRequest('Invalid post id');

    // $ifNull keeps the count right for documents written before the
    // denormalisation migration, without shipping the liker array back.
    const [post] = await Post.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(id) } },
      { $project: { userId: 1, likeCount: { $ifNull: ['$likeCount', { $size: '$likes' }] } } }
    ]);
    if (!post) throw notFound('Post not found');

    const [alreadyLiked, pendingAction] = await Promise.all([
      Post.exists({ _id: id, likes: userId }),
      readPendingLike(id, userId)
    ]);

    const dbHasLike = !!alreadyLiked;
    const currentlyLiked = pendingAction ? pendingAction === 'like' : dbHasLike;
    const action = currentlyLiked ? 'unlike' : 'like';
    const liked = action === 'like';

    // The stored count already contains the user's like when the database has
    // it. A queued toggle that has not flushed yet is not in the database, so
    // reconcile the two before applying this click.
    const base = Number.isFinite(post.likeCount) ? post.likeCount : 0;
    const effectiveBase = base
      + (pendingAction === 'like' && !dbHasLike ? 1 : 0)
      - (pendingAction === 'unlike' && dbHasLike ? 1 : 0);

    const buffered = await bufferLikeEvent(id, userId, action);
    if (buffered) {
      return res.status(200).json({
        likeCount: Math.max(0, effectiveBase + (liked ? 1 : -1)),
        liked,
        buffered: true
      });
    }

    const updated = await Post.findByIdAndUpdate(
      id,
      likePipeline(liked ? { adds: [userId] } : { removes: [userId] }),
      { new: true, projection: { likeCount: 1, userId: 1 } }
    ).lean();
    if (!updated) throw notFound('Post not found');

    if (liked && updated.likeCount === 10) {
      awardXp(updated.userId, 50, 'viral_gamer');
    }

    if (liked) {
      await notifyLikeMilestone({ post: updated, actor: req.user, likeCount: updated.likeCount });
    }

    res.status(200).json({ likeCount: updated.likeCount, liked });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/posts/tags/suggest?q=val
 * Prefix tag autocomplete. The `tags` index serves the anchored regex, and the
 * aggregation only ever returns tags that already exist on a post.
 */
const suggestTags = async (req, res, next) => {
  try {
    const q = sanitizeLine(req.query.q, 24).toLowerCase().replace(/^#/, '');
    if (!q) return res.status(200).json([]);

    const prefix = new RegExp(`^${escapeRegex(q)}`);
    const tags = await Post.aggregate([
      { $match: { tags: prefix, hiddenAt: null } },
      { $unwind: '$tags' },
      { $match: { tags: prefix } },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 8 },
      { $project: { _id: 0, tag: '$_id', count: 1 } }
    ]);

    return res.status(200).json(tags);
  } catch (err) {
    return next(err);
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

module.exports = {
  createPost,
  getPosts,
  getPostById,
  updatePost,
  deletePost,
  toggleLike,
  previewLink,
  suggestTags
};
