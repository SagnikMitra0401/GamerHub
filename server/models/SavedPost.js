const mongoose = require('mongoose');

/**
 * One bookmark edge. A post saved twice is the same row, and deleting the post
 * can find every bookmark from the `post` index instead of scanning users.
 */
const savedPostSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
  createdAt: { type: Date, default: Date.now },
});

savedPostSchema.index({ user: 1, post: 1 }, { unique: true, name: 'saved_post_pair' });
// The saved list, newest first.
savedPostSchema.index({ user: 1, createdAt: -1 }, { name: 'saved_post_recent' });
// Deleting a post clears its bookmarks.
savedPostSchema.index({ post: 1 }, { name: 'saved_post_post' });

module.exports = mongoose.model('SavedPost', savedPostSchema);
