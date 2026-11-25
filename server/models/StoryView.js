const mongoose = require('mongoose');

/**
 * One receipt per viewer per story.
 *
 * The unique compound index makes "mark as seen" idempotent under retries and
 * keeps the author's viewer list free of duplicates. Rows are removed with the
 * story; a small TTL on `createdAt` is a backstop for orphaned receipts.
 */
const StoryViewSchema = new mongoose.Schema(
  {
    storyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Story',
      required: true,
      index: true,
    },
    viewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
  },
  { timestamps: true },
);

StoryViewSchema.index({ storyId: 1, viewerId: 1 }, { unique: true, name: 'story_view_unique' });
StoryViewSchema.index({ storyId: 1, createdAt: -1 });
// Backstop for receipts whose story row was removed by its own TTL.
StoryViewSchema.index(
  { createdAt: 1 },
  { name: 'story_view_ttl', expireAfterSeconds: 30 * 24 * 60 * 60 },
);

module.exports = mongoose.model('StoryView', StoryViewSchema);
