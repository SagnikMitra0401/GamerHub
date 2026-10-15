const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  channelId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Channel',
    required: true,
    index: true
  },

  communityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Community',
    required: true,
    index: true
  },

  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  text: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },

  pinned: { type: Boolean, default: false }

}, { timestamps: true });

// Index for paginated channel history fetch (newest first)
MessageSchema.index({ channelId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', MessageSchema);
