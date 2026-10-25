const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const { parsePagination, parseObjectIdCursor } = require('../utils/pagination');
const { badRequest, notFound } = require('../utils/httpError');

const unreadCountFor = (userId) => Notification.countDocuments({ userId, read: false });

const MAX_CURSOR_LENGTH = 120;

/** Keyset cursor: last createdAt plus _id as the tiebreaker (createdAt repeats). */
function encodeCursor(item) {
  const createdAt = item.createdAt instanceof Date ? item.createdAt : new Date(item.createdAt);
  return Buffer.from(JSON.stringify([createdAt.toISOString(), String(item._id)]), 'utf8')
    .toString('base64url');
}

function decodeCursor(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_CURSOR_LENGTH) return null;
  try {
    const [timestamp, id] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    const createdAt = new Date(timestamp);
    const objectId = parseObjectIdCursor(id, mongoose);
    if (Number.isNaN(createdAt.getTime()) || !objectId) return null;
    return { createdAt, id: objectId };
  } catch {
    return null;
  }
}

// GET /api/notifications?unread=1&before=<cursor>
//
// Cursor pagination instead of skip/limit: a notification list only ever grows,
// and deep skip offsets get slower with every page. `nextCursor` is opaque and
// only valid for this user's list.
const listNotifications = async (req, res, next) => {
  try {
    const { limit } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 50 });

    const query = { userId: req.user._id };
    if (req.query.unread === '1') query.read = false;

    if (req.query.before) {
      const cursor = decodeCursor(String(req.query.before));
      if (!cursor) throw badRequest('Invalid cursor');
      query.$and = [{
        $or: [
          { createdAt: { $lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, _id: { $lt: cursor.id } }
        ]
      }];
    }

    const [items, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit)
        .lean(),
      unreadCountFor(req.user._id)
    ]);

    const nextCursor = items.length === limit ? encodeCursor(items[items.length - 1]) : null;

    res.status(200).json({ items, unreadCount, nextCursor, hasMore: Boolean(nextCursor) });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/notifications/:id/read
const markRead = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw badRequest('Invalid notification id');

    // Scoped by userId: an id alone must never grant access to someone else's ping.
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: { read: true } },
      { new: true }
    ).lean();

    if (!notification) throw notFound('Notification not found');

    res.status(200).json({ notification, unreadCount: await unreadCountFor(req.user._id) });
  } catch (err) {
    next(err);
  }
};

// POST /api/notifications/read-all
const markAllRead = async (req, res, next) => {
  try {
    await Notification.updateMany({ userId: req.user._id, read: false }, { $set: { read: true } });
    res.status(200).json({ ok: true, unreadCount: 0 });
  } catch (err) {
    next(err);
  }
};

module.exports = { listNotifications, markRead, markAllRead };
