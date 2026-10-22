const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const { parsePagination } = require('../utils/pagination');
const { badRequest, notFound } = require('../utils/httpError');

const unreadCountFor = (userId) => Notification.countDocuments({ userId, read: false });

// GET /api/notifications?unread=1
const listNotifications = async (req, res, next) => {
  try {
    const { skip, limit } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 50 });

    const query = { userId: req.user._id };
    if (req.query.unread === '1') query.read = false;

    const [items, unreadCount] = await Promise.all([
      Notification.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      unreadCountFor(req.user._id)
    ]);

    res.status(200).json({ items, unreadCount });
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
