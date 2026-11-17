const mongoose = require('mongoose');

/**
 * The single ledger for uploaded media.
 *
 * Posts, chat attachments and future surfaces all create a row here before the
 * content that references them is published. That is what makes orphan
 * cleanup, byte accounting and "which upload is this?" answerable from one
 * collection instead of three embedded fields.
 *
 * `publicId` is the durable identifier. Delivery URLs are derived from it with
 * a named transform (see utils/mediaDelivery), so changing card sizes or
 * formats never requires rewriting a stored URL.
 */
const MediaAssetSchema = new mongoose.Schema(
  {
    surface: {
      type: String,
      enum: ['post', 'chat', 'avatar', 'game', 'other'],
      required: true,
      index: true
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },

    provider: { type: String, enum: ['cloudinary'], default: 'cloudinary' },
    publicId: { type: String, required: true, unique: true },
    resourceType: { type: String, enum: ['image', 'video', 'raw'], default: 'image' },
    format: { type: String, default: null },
    mimeType: { type: String, default: null },
    bytes: { type: Number, default: 0, min: 0 },
    width: { type: Number, default: null },
    height: { type: Number, default: null },

    // Source URL kept for legacy rows and for the rare provider that cannot
    // derive a delivery URL. New code reads derivatives/publicId instead.
    url: { type: String, default: null },
    derivatives: {
      thumb: { type: String, default: null },
      card: { type: String, default: null },
      feed: { type: String, default: null },
      full: { type: String, default: null }
    },

    status: {
      type: String,
      enum: ['pending', 'ready', 'rejected', 'quarantined'],
      default: 'pending',
      index: true
    },
    refType: {
      type: String,
      enum: ['Post', 'Message', 'Game', 'User', null],
      default: null
    },
    refId: { type: mongoose.Schema.Types.ObjectId, default: null },

    // Rows imported from the pre-ledger era; they are never re-uploaded.
    legacy: { type: Boolean, default: false },
    schemaVersion: { type: Number, default: 1 }
  },
  { timestamps: true }
);

MediaAssetSchema.index({ surface: 1, createdAt: -1 });
MediaAssetSchema.index({ status: 1, createdAt: -1 });
MediaAssetSchema.index({ refType: 1, refId: 1 });
MediaAssetSchema.index({ ownerId: 1, createdAt: -1 });

module.exports = mongoose.model('MediaAsset', MediaAssetSchema);
