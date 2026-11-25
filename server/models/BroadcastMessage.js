const mongoose = require('mongoose');

/** One publication inside a broadcast channel. Read-only for subscribers. */
const BroadcastMessageSchema = new mongoose.Schema(
  {
    channelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BroadcastChannel',
      required: true,
      index: true,
    },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    text: { type: String, default: '', maxlength: 2000 },

    mediaUrl: { type: String, default: null },
    mediaCardUrl: { type: String, default: null },
    mediaType: { type: String, enum: ['image', 'video', 'none'], default: 'none' },
    mediaPublicId: { type: String, default: null },
    mediaAssetId: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset', default: null },

    publishedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

BroadcastMessageSchema.index({ channelId: 1, publishedAt: -1 });
BroadcastMessageSchema.index({ channelId: 1, _id: -1 });

module.exports = mongoose.model('BroadcastMessage', BroadcastMessageSchema);
