const fs = require('fs');
const mongoose = require('mongoose');

const BroadcastChannel = require('../models/BroadcastChannel');
const BroadcastMessage = require('../models/BroadcastMessage');
const BroadcastSubscription = require('../models/BroadcastSubscription');
const MediaAsset = require('../models/MediaAsset');
const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');
const { storeImageBuffer, registerVideoAsset, linkMediaAsset } = require('../utils/mediaPipeline');
const { mediaPublicId: buildMediaPublicId } = require('../utils/mediaPaths');
const { sanitizeLine, sanitizeText, isHttpUrl } = require('../utils/sanitize');
const { badRequest, forbidden, notFound } = require('../utils/httpError');
const {
  canPublish,
  canReadChannel,
  slugifyBroadcastName,
  uniqueSlug,
} = require('../utils/broadcastAccess');
const { notifyUser } = require('../utils/notify');
const { getIO } = require('../config/socket');
const { parseObjectIdCursor } = require('../utils/pagination');
const { BROADCAST_CATEGORIES } = require('../models/BroadcastChannel');

const MAX_CHANNELS_PER_OWNER = 3;
const MAX_NOTIFIED_SUBSCRIBERS = 200;

const cleanupTempFile = (path) => {
  if (path) fs.unlink(path, () => {});
};

const channelView = (channel, { subscription = null, user = null } = {}) => ({
  _id: String(channel._id),
  name: channel.name,
  slug: channel.slug,
  description: channel.description || '',
  avatarUrl: channel.avatarUrl || null,
  category: channel.category,
  isPublic: channel.isPublic,
  subscriberCount: channel.subscriberCount || 0,
  messageCount: channel.messageCount || 0,
  lastPublishedAt: channel.lastPublishedAt,
  isOwner: Boolean(user) && String(channel.ownerId) === String(user._id),
  canPublish: canPublish(channel, user),
  isSubscribed: Boolean(subscription),
  muted: Boolean(subscription?.muted),
  lastReadAt: subscription?.lastReadAt || null,
});

const messageView = (message) => ({
  _id: String(message._id),
  channelId: String(message.channelId),
  text: message.text || '',
  mediaUrl: message.mediaUrl || null,
  mediaCardUrl: message.mediaCardUrl || null,
  mediaType: message.mediaType || 'none',
  publishedAt: message.publishedAt,
  author: message.authorId?.username
    ? { _id: String(message.authorId._id), username: message.authorId.username }
    : null,
});

/** Pick a free slug in one read instead of probing candidate by candidate. */
async function freeSlug(name) {
  const base = slugifyBroadcastName(name);
  const taken = await BroadcastChannel.find({ slug: new RegExp(`^${base}`) })
    .select('slug')
    .lean();
  return uniqueSlug(
    base,
    taken.map((row) => row.slug),
  );
}

/** POST /api/channels */
const createChannel = async (req, res, next) => {
  try {
    const name = sanitizeLine(req.body.name, 50);
    if (!name || name.length < 2)
      throw badRequest('Give your channel a name of at least 2 characters.');

    const owned = await BroadcastChannel.countDocuments({ ownerId: req.user._id });
    if (owned >= MAX_CHANNELS_PER_OWNER) {
      throw badRequest(`You can own up to ${MAX_CHANNELS_PER_OWNER} channels.`);
    }

    const category = BROADCAST_CATEGORIES.includes(req.body.category)
      ? req.body.category
      : 'gaming';
    const avatarRaw = sanitizeLine(req.body.avatarUrl, 500);
    const avatarUrl = avatarRaw && isHttpUrl(avatarRaw) ? avatarRaw : null;

    const channel = await BroadcastChannel.create({
      ownerId: req.user._id,
      name,
      slug: await freeSlug(name),
      description: sanitizeText(req.body.description, 300),
      avatarUrl,
      category,
      isPublic: !(req.body.isPublic === false || req.body.isPublic === 'false'),
    });

    res.status(201).json(channelView(channel, { user: req.user }));
  } catch (err) {
    next(err);
  }
};

/** GET /api/channels — subscriptions with unread counts plus a discover list. */
const listChannels = async (req, res, next) => {
  try {
    const user = req.user || null;

    const subscriptions = user
      ? await BroadcastSubscription.find({ userId: user._id })
          .populate('channelId')
          .sort({ updatedAt: -1 })
          .limit(50)
          .lean()
      : [];

    const subscribed = subscriptions.filter((row) => row.channelId);

    // One aggregation instead of one count query per subscription (up to 50).
    const unreadRows =
      user && subscribed.length
        ? await BroadcastSubscription.aggregate([
            {
              $match: {
                userId: user._id,
                channelId: { $in: subscribed.map((row) => row.channelId._id) },
              },
            },
            {
              $lookup: {
                from: 'broadcastmessages',
                let: { channelId: '$channelId', lastReadAt: '$lastReadAt' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ['$channelId', '$$channelId'] },
                          { $gt: ['$publishedAt', { $ifNull: ['$$lastReadAt', new Date(0)] }] },
                        ],
                      },
                    },
                  },
                  { $count: 'count' },
                ],
                as: 'unread',
              },
            },
            {
              $project: {
                channelId: 1,
                unread: { $ifNull: [{ $arrayElemAt: ['$unread.count', 0] }, 0] },
              },
            },
          ])
        : [];
    const unreadByChannel = new Map(unreadRows.map((row) => [String(row.channelId), row.unread]));

    const withUnread = subscribed.map((row) => ({
      ...channelView(row.channelId, { subscription: row, user }),
      unread: unreadByChannel.get(String(row.channelId._id)) || 0,
    }));

    const discoverFilter = { isPublic: true };
    if (user) {
      discoverFilter.ownerId = { $ne: user._id };
      discoverFilter._id = { $nin: subscribed.map((row) => row.channelId._id) };
    }

    const owned = user
      ? await BroadcastChannel.find({ ownerId: user._id })
          .sort({ createdAt: -1 })
          .limit(MAX_CHANNELS_PER_OWNER)
          .lean()
      : [];

    const discover = await BroadcastChannel.find(discoverFilter)
      .sort({ subscriberCount: -1, createdAt: -1 })
      .limit(12)
      .lean();

    res.status(200).json({
      subscriptions: withUnread,
      owned: owned.map((channel) => channelView(channel, { user })),
      discover: discover.map((channel) => channelView(channel, { user })),
    });
  } catch (err) {
    next(err);
  }
};

/** GET /api/channels/:slug */
const getChannel = async (req, res, next) => {
  try {
    const channel = await BroadcastChannel.findOne({
      slug: String(req.params.slug).toLowerCase(),
    }).lean();
    if (!channel) throw notFound('Channel not found');

    const subscription = req.user
      ? await BroadcastSubscription.findOne({ channelId: channel._id, userId: req.user._id }).lean()
      : null;

    if (!canReadChannel({ channel, user: req.user, subscription })) {
      throw forbidden('This channel is private.');
    }

    res.status(200).json(channelView(channel, { subscription, user: req.user }));
  } catch (err) {
    next(err);
  }
};

/** POST /api/channels/:slug/subscribe */
const subscribe = async (req, res, next) => {
  try {
    const channel = await BroadcastChannel.findOne({ slug: String(req.params.slug).toLowerCase() });
    if (!channel) throw notFound('Channel not found');
    if (String(channel.ownerId) === String(req.user._id)) {
      throw badRequest('You already own this channel.');
    }
    if (!channel.isPublic) throw forbidden('This channel is private.');

    const result = await BroadcastSubscription.updateOne(
      { channelId: channel._id, userId: req.user._id },
      { $setOnInsert: { lastReadAt: new Date() } },
      { upsert: true },
    );

    const created = Boolean(result.upsertedCount);
    if (created) {
      await BroadcastChannel.updateOne({ _id: channel._id }, { $inc: { subscriberCount: 1 } });
    }

    const subscription = await BroadcastSubscription.findOne({
      channelId: channel._id,
      userId: req.user._id,
    }).lean();

    res.status(200).json({
      subscribed: true,
      created,
      channel: channelView(channel, { subscription, user: req.user }),
    });
  } catch (err) {
    next(err);
  }
};

/** DELETE /api/channels/:slug/subscribe */
const unsubscribe = async (req, res, next) => {
  try {
    const channel = await BroadcastChannel.findOne({ slug: String(req.params.slug).toLowerCase() });
    if (!channel) throw notFound('Channel not found');

    const result = await BroadcastSubscription.deleteOne({
      channelId: channel._id,
      userId: req.user._id,
    });
    if (result.deletedCount) {
      await BroadcastChannel.updateOne(
        { _id: channel._id, subscriberCount: { $gt: 0 } },
        { $inc: { subscriberCount: -1 } },
      );
    }

    res.status(200).json({ subscribed: false });
  } catch (err) {
    next(err);
  }
};

/** PATCH /api/channels/:slug/subscription — mute/unmute notifications. */
const setMuted = async (req, res, next) => {
  try {
    if (typeof req.body.muted !== 'boolean') throw badRequest('muted must be true or false.');

    const channel = await BroadcastChannel.findOne({ slug: String(req.params.slug).toLowerCase() });
    if (!channel) throw notFound('Channel not found');

    const subscription = await BroadcastSubscription.findOneAndUpdate(
      { channelId: channel._id, userId: req.user._id },
      { $set: { muted: req.body.muted } },
      { new: true },
    ).lean();

    if (!subscription) throw notFound('Subscribe to this channel first.');

    res.status(200).json({ muted: subscription.muted });
  } catch (err) {
    next(err);
  }
};

/** POST /api/channels/:slug/read — advance the unread marker. */
const markRead = async (req, res, next) => {
  try {
    const channel = await BroadcastChannel.findOne({ slug: String(req.params.slug).toLowerCase() });
    if (!channel) throw notFound('Channel not found');

    const subscription = await BroadcastSubscription.findOneAndUpdate(
      { channelId: channel._id, userId: req.user._id },
      { $set: { lastReadAt: new Date() } },
      { new: true },
    ).lean();

    if (!subscription) throw notFound('Subscribe to this channel first.');

    res.status(200).json({ lastReadAt: subscription.lastReadAt });
  } catch (err) {
    next(err);
  }
};

/** GET /api/channels/:slug/messages — cursor paged, newest first. */
const getMessages = async (req, res, next) => {
  try {
    const channel = await BroadcastChannel.findOne({
      slug: String(req.params.slug).toLowerCase(),
    }).lean();
    if (!channel) throw notFound('Channel not found');

    const subscription = req.user
      ? await BroadcastSubscription.findOne({ channelId: channel._id, userId: req.user._id }).lean()
      : null;
    if (!canReadChannel({ channel, user: req.user, subscription })) {
      throw forbidden('This channel is private.');
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const before = parseObjectIdCursor(req.query.before, mongoose);
    const filter = { channelId: channel._id };
    if (before) filter._id = { $lt: before };

    const rows = await BroadcastMessage.find(filter)
      .sort({ _id: -1 })
      .limit(limit)
      .populate('authorId', 'username')
      .lean();

    const items = rows.map(messageView);
    const nextBefore = rows.length === limit ? String(rows[rows.length - 1]._id) : null;

    res.status(200).json({ items, nextBefore });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/channels/:slug/messages
 * Owner/staff only. Fans out one deduped notification per subscriber (muted
 * subscriptions are skipped) and emits the live event.
 */
const publishMessage = async (req, res, next) => {
  let tempFilePath = null;
  try {
    const channel = await BroadcastChannel.findOne({ slug: String(req.params.slug).toLowerCase() });
    if (!channel) throw notFound('Channel not found');
    if (!canPublish(channel, req.user)) throw forbidden('Only the owner can publish here.');

    const text = sanitizeText(req.body.text, 2000);
    let mediaUrl = null;
    let mediaCardUrl = null;
    let mediaType = 'none';
    let mediaPublicId = null;
    let mediaAssetId = null;

    if (req.file) {
      tempFilePath = req.file.path;
      const isVideo = req.file.mimetype.startsWith('video/');
      const maxAllowed = isVideo ? 50 * 1024 * 1024 : 5 * 1024 * 1024;
      if (req.file.size > maxAllowed) {
        cleanupTempFile(tempFilePath);
        tempFilePath = null;
        throw badRequest(
          isVideo
            ? 'Broadcast videos must be 50MB or less.'
            : 'Broadcast images must be 5MB or less.',
        );
      }

      if (isVideo) {
        const publicId = buildMediaPublicId({ surface: 'broadcast', ownerId: req.user._id });
        const result = await uploadToCloudinary(tempFilePath, { publicId, resourceType: 'video' });
        const asset = await registerVideoAsset({
          result,
          ownerId: req.user._id,
          surface: 'broadcast',
        });
        mediaUrl = asset.derivatives.video || result.secure_url;
        mediaType = 'video';
        mediaPublicId = result.public_id;
        mediaAssetId = asset._id;
      } else {
        const buffer = await fs.promises.readFile(tempFilePath);
        const { asset, result } = await storeImageBuffer({
          buffer,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          surface: 'broadcast',
          ownerId: req.user._id,
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

    if (!text && !mediaUrl) throw badRequest('Write something or attach media.');

    const message = await BroadcastMessage.create({
      channelId: channel._id,
      authorId: req.user._id,
      text,
      mediaUrl,
      mediaCardUrl,
      mediaType,
      mediaPublicId,
      mediaAssetId,
      publishedAt: new Date(),
    });

    if (mediaAssetId) {
      await linkMediaAsset(mediaAssetId, { refType: 'Broadcast', refId: message._id });
    }

    await BroadcastChannel.updateOne(
      { _id: channel._id },
      { $inc: { messageCount: 1 }, $set: { lastPublishedAt: message.publishedAt } },
    );

    const payload = {
      ...messageView({
        ...message.toObject(),
        authorId: { _id: req.user._id, username: req.user.username },
      }),
    };

    getIO()
      ?.to(`broadcast:${String(channel._id)}`)
      .emit('broadcast_message', payload);

    // Fan out notifications. Muted subscribers get the post in-app but no ping;
    // the threshold keeps a huge channel from writing thousands of rows per
    // publish (large channels rely on the tab unread badge instead).
    const subscribers = await BroadcastSubscription.find({
      channelId: channel._id,
      muted: false,
      userId: { $ne: req.user._id },
    })
      .select('userId')
      .limit(MAX_NOTIFIED_SUBSCRIBERS)
      .lean();

    await Promise.allSettled(
      subscribers.map((subscriber) =>
        notifyUser({
          userId: subscriber.userId,
          type: 'broadcast',
          actorId: req.user._id,
          title: channel.name,
          message: text ? text.slice(0, 120) : 'New media post',
          actionUrl: `/channels/${channel.slug}`,
          mediaThumbnail: mediaCardUrl,
          metadata: { kind: 'broadcast', channelId: String(channel._id) },
          dedupeKey: `broadcast:${message._id}`,
        }),
      ),
    );

    res.status(201).json(payload);
  } catch (err) {
    cleanupTempFile(tempFilePath);
    next(err);
  }
};

/** DELETE /api/channels/:slug — owner/staff only, with all posts and media. */
const deleteChannel = async (req, res, next) => {
  try {
    const channel = await BroadcastChannel.findOne({ slug: String(req.params.slug).toLowerCase() });
    if (!channel) throw notFound('Channel not found');
    if (!canPublish(channel, req.user)) throw forbidden('Only the owner can delete this channel.');

    const messages = await BroadcastMessage.find({ channelId: channel._id })
      .select('_id mediaPublicId mediaType mediaAssetId')
      .lean();

    await Promise.allSettled(
      messages.map((message) =>
        message.mediaPublicId
          ? deleteFromCloudinary(
              message.mediaPublicId,
              message.mediaType === 'video' ? 'video' : 'image',
            )
          : Promise.resolve(),
      ),
    );
    const assetIds = messages.map((message) => message.mediaAssetId).filter(Boolean);
    if (assetIds.length) await MediaAsset.deleteMany({ _id: { $in: assetIds } });

    await BroadcastMessage.deleteMany({ channelId: channel._id });
    await BroadcastSubscription.deleteMany({ channelId: channel._id });
    await channel.deleteOne();

    res.status(200).json({ deleted: true });
  } catch (err) {
    next(err);
  }
};

/** DELETE /api/channels/:slug/messages/:messageId */
const deleteMessage = async (req, res, next) => {
  try {
    const channel = await BroadcastChannel.findOne({ slug: String(req.params.slug).toLowerCase() });
    if (!channel) throw notFound('Channel not found');
    if (!canPublish(channel, req.user)) throw forbidden('Only the owner can delete posts here.');

    if (!mongoose.Types.ObjectId.isValid(req.params.messageId))
      throw badRequest('Invalid message id');
    const message = await BroadcastMessage.findOne({
      _id: req.params.messageId,
      channelId: channel._id,
    });
    if (!message) throw notFound('Post not found');

    if (message.mediaPublicId) {
      await deleteFromCloudinary(
        message.mediaPublicId,
        message.mediaType === 'video' ? 'video' : 'image',
      ).catch((err) => console.error('[Broadcast] Cloudinary delete failed:', err.message));
    }
    if (message.mediaAssetId)
      await MediaAsset.deleteOne({ _id: message.mediaAssetId }).catch(() => {});

    await BroadcastMessage.deleteOne({ _id: message._id });
    await BroadcastChannel.updateOne(
      { _id: channel._id, messageCount: { $gt: 0 } },
      { $inc: { messageCount: -1 } },
    );

    res.status(200).json({ deleted: true });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createChannel,
  listChannels,
  getChannel,
  subscribe,
  unsubscribe,
  setMuted,
  markRead,
  getMessages,
  publishMessage,
  deleteChannel,
  deleteMessage,
};
