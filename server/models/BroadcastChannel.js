const mongoose = require('mongoose');

/**
 * A one-way broadcast channel (WhatsApp-channel style).
 *
 * Readers subscribe; only the owner (or platform staff) publishes. This is
 * deliberately separate from community channels: a community channel is a
 * conversation inside a server, while a broadcast channel is a publication
 * with subscribers and unread state.
 */

const BROADCAST_CATEGORIES = ['gaming', 'esports', 'news', 'community', 'creator', 'other'];

const BroadcastChannelSchema = new mongoose.Schema({
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 50 },
  slug: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    maxlength: 60,
    match: /^[a-z0-9-]+$/
  },
  description: { type: String, default: '', trim: true, maxlength: 300 },
  avatarUrl: { type: String, default: null, maxlength: 500 },
  category: { type: String, enum: BROADCAST_CATEGORIES, default: 'gaming' },
  isPublic: { type: Boolean, default: true },

  subscriberCount: { type: Number, default: 0, min: 0 },
  messageCount: { type: Number, default: 0, min: 0 },
  lastPublishedAt: { type: Date, default: null }
}, { timestamps: true });

BroadcastChannelSchema.index({ ownerId: 1, createdAt: -1 });
BroadcastChannelSchema.index({ isPublic: 1, subscriberCount: -1, createdAt: -1 });
BroadcastChannelSchema.index({ category: 1, isPublic: 1 });

module.exports = mongoose.model('BroadcastChannel', BroadcastChannelSchema);
module.exports.BROADCAST_CATEGORIES = BROADCAST_CATEGORIES;
