const fs = require('fs');
const mongoose = require('mongoose');

const Story = require('../models/Story');
const StoryView = require('../models/StoryView');
const MediaAsset = require('../models/MediaAsset');
const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');
const { storeImageBuffer, registerVideoAsset, linkMediaAsset } = require('../utils/mediaPipeline');
const { mediaPublicId: buildMediaPublicId } = require('../utils/mediaPaths');
const { sanitizeLine } = require('../utils/sanitize');
const { badRequest, forbidden, notFound } = require('../utils/httpError');
const { canViewStory, groupStories, idOf } = require('../utils/storyAccess');
const { STORY_TTL_MS, STORY_BACKGROUNDS, STORY_VISIBILITY } = require('../models/Story');

const HIDDEN_STATUS = ['frozen', 'suspended', 'deleted', 'deletion_pending'];
const isStaff = (user) => ['admin', 'moderator'].includes(user?.role);

const cleanupTempFile = (path) => {
  if (path) fs.unlink(path, () => {});
};

/**
 * POST /api/stories
 * A text status needs no file; an image or video is validated, normalised and
 * recorded in the media ledger exactly like a post.
 */
const createStory = async (req, res, next) => {
  let tempFilePath = null;
  try {
    const visibility = STORY_VISIBILITY.includes(req.body.visibility)
      ? req.body.visibility
      : 'followers';
    const background = STORY_BACKGROUNDS.includes(req.body.background)
      ? req.body.background
      : 'aurora';
    const caption = sanitizeLine(req.body.caption, 200);
    const text = sanitizeLine(req.body.text, 200);

    let kind = 'text';
    let mediaUrl = null;
    let mediaCardUrl = null;
    let mediaPublicId = null;
    let mediaAssetId = null;

    if (!req.file) {
      if (!text) throw badRequest('Write something or choose a photo or video.');
    } else {
      tempFilePath = req.file.path;
      const isVideo = req.file.mimetype.startsWith('video/');
      const maxAllowed = isVideo ? 50 * 1024 * 1024 : 5 * 1024 * 1024;

      if (req.file.size > maxAllowed) {
        cleanupTempFile(tempFilePath);
        tempFilePath = null;
        throw badRequest(
          isVideo ? 'Story videos must be 50MB or less.' : 'Story images must be 5MB or less.',
        );
      }

      if (isVideo) {
        const publicId = buildMediaPublicId({ surface: 'story', ownerId: req.user._id });
        const result = await uploadToCloudinary(tempFilePath, { publicId, resourceType: 'video' });
        const asset = await registerVideoAsset({
          result,
          ownerId: req.user._id,
          surface: 'story',
        });
        mediaUrl = asset.derivatives.video || result.secure_url;
        mediaPublicId = result.public_id;
        mediaAssetId = asset._id;
        kind = 'video';
      } else {
        const buffer = await fs.promises.readFile(tempFilePath);
        const { asset, result } = await storeImageBuffer({
          buffer,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          surface: 'story',
          ownerId: req.user._id,
        });
        mediaUrl = asset.derivatives.full || result.secure_url;
        mediaCardUrl = asset.derivatives.card;
        mediaPublicId = result.public_id;
        mediaAssetId = asset._id;
        kind = 'image';
      }

      cleanupTempFile(tempFilePath);
      tempFilePath = null;
    }

    const story = await Story.create({
      authorId: req.user._id,
      kind,
      text: kind === 'text' ? text : '',
      background,
      caption,
      visibility,
      mediaUrl,
      mediaCardUrl,
      mediaPublicId,
      mediaAssetId,
      expiresAt: new Date(Date.now() + STORY_TTL_MS),
    });

    if (mediaAssetId) {
      await linkMediaAsset(mediaAssetId, { refType: 'Story', refId: story._id });
    }

    res.status(201).json({
      _id: String(story._id),
      kind: story.kind,
      text: story.text,
      background: story.background,
      mediaUrl: story.mediaUrl,
      mediaCardUrl: story.mediaCardUrl,
      caption: story.caption,
      visibility: story.visibility,
      createdAt: story.createdAt,
      expiresAt: story.expiresAt,
      author: {
        _id: String(req.user._id),
        username: req.user.username,
        level: req.user.level || 1,
        role: req.user.role || 'user',
      },
    });
  } catch (err) {
    cleanupTempFile(tempFilePath);
    next(err);
  }
};

/**
 * GET /api/stories
 * Followed authors plus your own stories, with public stories for everyone
 * else. Grouped by author and ordered unseen-first by `groupStories`.
 */
const getStories = async (req, res, next) => {
  try {
    const viewer = req.user || null;
    const viewerId = viewer?._id ? String(viewer._id) : null;
    const followingIds = viewer?.following || [];
    const blockedIds = viewer?.blockedUsers || [];

    // Filter by visibility in the database, not after a fixed 300-row window:
    // a burst of public stories must not crowd followed authors out of the rail.
    const authorScope = viewer
      ? [
          { authorId: viewer._id },
          ...(followingIds.length ? [{ authorId: { $in: followingIds } }] : []),
        ]
      : [];
    const stories = await Story.find({
      expiresAt: { $gt: new Date() },
      $or: [{ visibility: 'public' }, ...authorScope],
    })
      .sort({ createdAt: -1 })
      .limit(300)
      .populate('authorId', 'username level role status blockedUsers avatarUrl')
      .lean();

    const visible = stories.filter((story) => {
      const author = story.authorId;
      if (!author) return false;

      const authorId = idOf(author);
      if (HIDDEN_STATUS.includes(author.status) && authorId !== viewerId) return false;

      // A block in either direction removes the story, even a public one.
      if (viewerId) {
        const authorBlockedViewer = (author.blockedUsers || []).map(String).includes(viewerId);
        if (authorBlockedViewer) return false;
      }

      return canViewStory({ story, viewerId, followingIds, blockedIds });
    });

    let seenIds = [];
    if (viewer && visible.length) {
      const rows = await StoryView.find({
        viewerId: viewer._id,
        storyId: { $in: visible.map((story) => story._id) },
      })
        .select('storyId')
        .lean();
      seenIds = rows.map((row) => String(row.storyId));
    }

    res.status(200).json(groupStories({ stories: visible, seenIds, viewerId }));
  } catch (err) {
    next(err);
  }
};

/** POST /api/stories/:id/view — idempotent receipt. */
const viewStory = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) throw badRequest('Invalid story id');

    const story = await Story.findOne({ _id: id, expiresAt: { $gt: new Date() } }).lean();
    if (!story) throw notFound('That story has expired.');

    const allowed = canViewStory({
      story,
      viewerId: req.user._id,
      followingIds: req.user.following || [],
      blockedIds: req.user.blockedUsers || [],
    });
    if (!allowed) throw forbidden('You cannot view this story.');

    const result = await StoryView.updateOne(
      { storyId: story._id, viewerId: req.user._id },
      { $setOnInsert: { storyId: story._id, viewerId: req.user._id } },
      { upsert: true },
    );

    const counted = Boolean(result.upsertedCount);
    if (counted) await Story.updateOne({ _id: story._id }, { $inc: { viewCount: 1 } });

    res.status(200).json({ viewed: true, counted });
  } catch (err) {
    next(err);
  }
};

/** GET /api/stories/:id/viewers — author or staff only. */
const getStoryViewers = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) throw badRequest('Invalid story id');

    const story = await Story.findOne({ _id: id, expiresAt: { $gt: new Date() } }).lean();
    if (!story) throw notFound('Story not found');

    const owner = String(story.authorId) === String(req.user._id);
    if (!owner && !isStaff(req.user))
      throw forbidden('Only the author can see who viewed this story.');

    const rows = await StoryView.find({ storyId: story._id })
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('viewerId', 'username level')
      .lean();

    res.status(200).json({
      count: story.viewCount || 0,
      viewers: rows
        .filter((row) => row.viewerId)
        .map((row) => ({
          _id: String(row.viewerId._id),
          username: row.viewerId.username,
          level: row.viewerId.level || 1,
          viewedAt: row.createdAt,
        })),
    });
  } catch (err) {
    next(err);
  }
};

/** DELETE /api/stories/:id — author or staff. */
const deleteStory = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) throw badRequest('Invalid story id');

    const story = await Story.findById(id);
    if (!story) throw notFound('Story not found');

    if (String(story.authorId) !== String(req.user._id) && !isStaff(req.user)) {
      throw forbidden('You cannot delete this story.');
    }

    if (story.mediaPublicId) {
      await deleteFromCloudinary(
        story.mediaPublicId,
        story.kind === 'video' ? 'video' : 'image',
      ).catch((err) => console.error('[Story] Cloudinary delete failed:', err.message));
    }
    if (story.mediaAssetId) {
      await MediaAsset.deleteOne({ _id: story.mediaAssetId }).catch(() => {});
    }

    await StoryView.deleteMany({ storyId: story._id });
    await Story.deleteOne({ _id: story._id });

    res.status(200).json({ deleted: true });
  } catch (err) {
    next(err);
  }
};

module.exports = { createStory, getStories, viewStory, getStoryViewers, deleteStory };
