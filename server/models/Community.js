const mongoose = require('mongoose');

// Member entry inside a community
const memberSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role:     { type: String, enum: ['owner', 'admin', 'moderator', 'member'], default: 'member' },
  joinedAt: { type: Date, default: Date.now }
}, { _id: false });

const CommunitySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 40
  },

  // URL-friendly slug (e.g. "valorant-elite-apac")
  slug: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    maxlength: 50,
    match: /^[a-z0-9_-]+$/
  },

  description: { type: String, default: '', trim: true, maxlength: 200 },
  icon:        { type: String, default: '🎮', trim: true, maxlength: 100 },  // emoji or image URL
  banner:      { type: String, default: '', trim: true },                     // optional image URL

  ownerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members:  { type: [memberSchema], default: [] },
  isPrivate:{ type: Boolean, default: false },

  // Telegram pattern: Community-wide content protection
  contentProtection: {
    restrictCopy: { type: Boolean, default: false },
    restrictMedia: { type: Boolean, default: false }
  }

}, { timestamps: true });

// Helper: get a member's role (returns null if not a member)
CommunitySchema.methods.getMemberRole = function(userId) {
  const member = this.members.find(m => m.userId.toString() === userId.toString());
  return member ? member.role : null;
};

// Role hierarchy: higher index = more authority
const ROLE_LEVELS = { member: 0, moderator: 1, admin: 2, owner: 3 };

// Helper: check if a role has AT LEAST the required minimum authority
CommunitySchema.statics.roleAtLeast = function(userRole, minRole) {
  return (ROLE_LEVELS[userRole] ?? -1) >= (ROLE_LEVELS[minRole] ?? 99);
};

module.exports = mongoose.model('Community', CommunitySchema);
