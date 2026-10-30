const mongoose = require('mongoose');

const FORUM_STATUSES = ['open', 'answered', 'locked', 'archived'];

const ForumPostSchema = new mongoose.Schema({
  channelId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true, index: true },
  communityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Community', required: true, index: true },
  authorId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  title: { type: String, required: true, trim: true, maxlength: 100 },
  body:  { type: String, required: true, trim: true, maxlength: 4000 },

  tags: {
    type: [String],
    default: [],
    set: (arr) => (Array.isArray(arr)
      ? arr.map((tag) => String(tag).trim().toLowerCase().slice(0, 24)).filter(Boolean).slice(0, 5)
      : [])
  },

  status:    { type: String, enum: FORUM_STATUSES, default: 'open' },
  pinned:    { type: Boolean, default: false },
  replyCount:  { type: Number, default: 0 },
  lastReplyAt: { type: Date, default: null },

  // GDPR soft delete — the row survives so replies keep their parent.
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

ForumPostSchema.index({ channelId: 1, createdAt: -1 });
ForumPostSchema.index({ channelId: 1, status: 1, createdAt: -1 });
ForumPostSchema.index({ channelId: 1, tags: 1 });
ForumPostSchema.index(
  { title: 'text', body: 'text' },
  { weights: { title: 10, body: 1 }, name: 'forumpost_text_weighted' }
);

module.exports = mongoose.model('ForumPost', ForumPostSchema);
module.exports.FORUM_STATUSES = FORUM_STATUSES;
