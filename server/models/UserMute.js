const mongoose = require('mongoose');

/**
 * One personal mute edge: `muter` hides `muted`'s content from their own view.
 * A mute is not a moderation action and never stops delivery to anyone else.
 */
const userMuteSchema = new mongoose.Schema({
  muter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  muted: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
});

userMuteSchema.index({ muter: 1, muted: 1 }, { unique: true, name: 'user_mute_pair' });
userMuteSchema.index({ muter: 1, createdAt: -1 }, { name: 'user_mute_recent' });

module.exports = mongoose.model('UserMute', userMuteSchema);
