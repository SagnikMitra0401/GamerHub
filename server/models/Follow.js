const mongoose = require('mongoose');

/**
 * One directed follow edge.
 *
 * The pair is the identity of the row: a unique compound index makes a repeated
 * follow a no-op instead of a second row, so the follower count can never drift
 * from the number of edges. `createdAt` carries the follow date so the followers
 * list can paginate newest-first without loading either user's array.
 */
const followSchema = new mongoose.Schema({
  follower: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  following: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
});

followSchema.index({ follower: 1, following: 1 }, { unique: true, name: 'follow_pair' });
// Who follows this account, newest first (followers list).
followSchema.index({ following: 1, createdAt: -1 }, { name: 'follow_incoming' });
// Who this account follows, newest first (following list).
followSchema.index({ follower: 1, createdAt: -1 }, { name: 'follow_outgoing' });

module.exports = mongoose.model('Follow', followSchema);
