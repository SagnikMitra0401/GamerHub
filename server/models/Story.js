const mongoose = require('mongoose');

/**
 * A 24-hour story / status.
 *
 * Expiry is enforced twice: `expiresAt` is always a real date and the TTL index
 * removes the row, while every read query also filters on it so a lagging TTL
 * monitor can never serve an expired story.
 */

const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const STORY_KINDS = ['text', 'image', 'video'];
const STORY_VISIBILITY = ['followers', 'public'];
const STORY_BACKGROUNDS = ['aurora', 'sunset', 'ocean', 'ember', 'forest'];

const StorySchema = new mongoose.Schema(
  {
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    kind: { type: String, enum: STORY_KINDS, required: true },

    // Text statuses only.
    text: { type: String, default: '', maxlength: 200 },
    background: { type: String, enum: STORY_BACKGROUNDS, default: 'aurora' },

    // Media statuses reuse the post media fields so the same ledger and delivery
    // transforms apply.
    mediaUrl: { type: String, default: null },
    mediaCardUrl: { type: String, default: null },
    mediaPublicId: { type: String, default: null },
    mediaAssetId: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset', default: null },

    caption: { type: String, default: '', maxlength: 200 },
    visibility: { type: String, enum: STORY_VISIBILITY, default: 'followers' },

    viewCount: { type: Number, default: 0, min: 0 },

    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + STORY_TTL_MS),
    },
  },
  { timestamps: true },
);

StorySchema.index({ authorId: 1, createdAt: -1 });
StorySchema.index({ visibility: 1, createdAt: -1 });
// TTL monitor removes the row once expiresAt passes.
StorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'story_expiry_ttl' });

module.exports = mongoose.model('Story', StorySchema);
module.exports.STORY_TTL_MS = STORY_TTL_MS;
module.exports.STORY_KINDS = STORY_KINDS;
module.exports.STORY_VISIBILITY = STORY_VISIBILITY;
module.exports.STORY_BACKGROUNDS = STORY_BACKGROUNDS;
