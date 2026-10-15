const mongoose = require('mongoose');

const ChannelSchema = new mongoose.Schema({
  communityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Community',
    required: true,
    index: true
  },

  name: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 40,
    // Channel names are slug-style: letters, numbers, hyphens only
    match: /^[a-z0-9-]+$/
  },

  topic:    { type: String, default: '', trim: true, maxlength: 100 },
  type:     { type: String, enum: ['text', 'announcement'], default: 'text' },
  position: { type: Number, default: 0 },

  // Minimum community role required to READ messages in this channel
  minRoleToRead:  {
    type: String,
    enum: ['member', 'moderator', 'admin', 'owner'],
    default: 'member'
  },

  // Minimum community role required to WRITE/SEND messages in this channel
  minRoleToWrite: {
    type: String,
    enum: ['member', 'moderator', 'admin', 'owner'],
    default: 'member'
  }

}, { timestamps: true });

// Compound uniqueness: channel name must be unique within a community
ChannelSchema.index({ communityId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Channel', ChannelSchema);
