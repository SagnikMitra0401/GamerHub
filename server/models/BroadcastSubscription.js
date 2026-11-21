const mongoose = require('mongoose');

/**
 * A reader's relationship with a broadcast channel.
 *
 * `lastReadAt` drives the unread badge and is advanced only by an explicit
 * mark-read call, so opening the list does not silently swallow new posts.
 */
const BroadcastSubscriptionSchema = new mongoose.Schema({
  channelId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BroadcastChannel',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  muted: { type: Boolean, default: false },
  lastReadAt: { type: Date, default: null }
}, { timestamps: true });

BroadcastSubscriptionSchema.index(
  { channelId: 1, userId: 1 },
  { unique: true, name: 'broadcast_subscription_unique' }
);
BroadcastSubscriptionSchema.index({ userId: 1, updatedAt: -1 });

module.exports = mongoose.model('BroadcastSubscription', BroadcastSubscriptionSchema);
