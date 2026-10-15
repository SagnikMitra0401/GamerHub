const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  communityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Community',
    required: true,
    index: true
  },
  actorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  actionType: {
    type: String,
    enum: [
      'ROLE_UPDATE',
      'MEMBER_KICK',
      'CHANNEL_CREATE',
      'CHANNEL_DELETE',
      'MESSAGE_PURGE',
      'SETTINGS_UPDATE'
    ],
    required: true
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  targetModel: {
    type: String,
    enum: ['User', 'Channel', 'Message', 'Community', null],
    default: null
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true });

// Compound index for fast chronological audit lookups
AuditLogSchema.index({ communityId: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
