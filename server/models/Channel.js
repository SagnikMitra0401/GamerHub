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
  },

  // Discord pattern: Slowmode cooldown in seconds (0 = disabled, 5, 15, 30, 60s)
  slowModeSeconds: {
    type: Number,
    default: 0,
    min: 0,
    max: 120
  },

  // Telegram pattern: Auto-retention days (0 = keep forever, 30, 60, 90 days)
  retentionDays: {
    type: Number,
    default: 0,
    min: 0,
    max: 365
  },

  // Content protection flag (disable copy, text-select, drag-drop in client)
  isProtected: {
    type: Boolean,
    default: false
  }

}, { timestamps: true });

// Compound uniqueness: channel name must be unique within a community
ChannelSchema.index({ communityId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Channel', ChannelSchema);
