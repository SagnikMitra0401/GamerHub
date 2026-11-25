const mongoose = require('mongoose');

/**
 * One directed block edge: `blocker` never wants to see `blocked`.
 *
 * The effect is symmetric in every read path, but the row is stored once in the
 * direction the block was made, so unblocking removes exactly that row and the
 * other person's own blocks stay untouched.
 */
const userBlockSchema = new mongoose.Schema({
  blocker: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  blocked: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
});

userBlockSchema.index({ blocker: 1, blocked: 1 }, { unique: true, name: 'user_block_pair' });
// "Who blocked me" — the reverse direction every symmetric filter needs.
userBlockSchema.index({ blocked: 1, blocker: 1 }, { name: 'user_block_incoming' });

module.exports = mongoose.model('UserBlock', userBlockSchema);
