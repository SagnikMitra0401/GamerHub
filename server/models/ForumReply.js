const mongoose = require('mongoose');

const ForumReplySchema = new mongoose.Schema({
  postId:      { type: mongoose.Schema.Types.ObjectId, ref: 'ForumPost', required: true, index: true },
  channelId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true },
  communityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Community', required: true },
  authorId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  body: { type: String, required: true, trim: true, maxlength: 2000 },

  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  isEdited:  { type: Boolean, default: false }
}, { timestamps: true });

ForumReplySchema.index({ postId: 1, createdAt: 1 });

module.exports = mongoose.model('ForumReply', ForumReplySchema);
