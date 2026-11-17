const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  // Null for platform-level actions; community moderation always carries it.
  communityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Community',
    default: null,
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
      'MEMBER_ADD',
      'MEMBER_KICK',
      'CHANNEL_CREATE',
      'CHANNEL_UPDATE',
      'CHANNEL_DELETE',
      'MESSAGE_PURGE',
      'SETTINGS_UPDATE',
      'MEMBER_TIMEOUT',
      'MEMBER_TIMEOUT_LIFT',
      'MEMBER_BAN',
      'MEMBER_UNBAN',
      'MESSAGE_PIN',
      'MESSAGE_UNPIN',
      'REPORT_REVIEWED',
      'FORUM_POST_LOCK',
      'FORUM_POST_ARCHIVE',
      'FORUM_POST_REOPEN',
      'FORUM_POST_DELETE',
      'OWNER_TRANSFER',
      'INVITE_CREATE',
      'INVITE_REVOKE',
      'INVITE_JOIN',
      'INVITE_REQUEST',
      'INVITE_APPROVE',
      'INVITE_DENY',
      'PLATFORM_ROLE_UPDATE',
      'PLATFORM_STATUS_UPDATE',
      'PLATFORM_FORCE_LOGOUT',
      'PLATFORM_REPORT_RESOLVE',
      'PLATFORM_CONTENT_HIDE',
      'PLATFORM_CONTENT_RESTORE',
      'PLATFORM_GAME_UPDATE',
      'PLATFORM_GAME_MERGE',
      'PLATFORM_GAME_SYNC',
      'PLATFORM_EMAIL_RESEND'
    ],
    required: true
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  targetModel: {
    type: String,
    enum: [
      'User', 'Channel', 'Message', 'Community', 'ForumPost', 'Report',
      'CommunityInvite', 'Post', 'Comment', 'DmReport', 'Game', 'MediaAsset', null
    ],
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
