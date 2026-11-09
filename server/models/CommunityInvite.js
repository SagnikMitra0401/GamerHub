const mongoose = require('mongoose');

/**
 * A shareable link that lets someone outside a server join it.
 *
 * The code is the secret: anyone holding it can join until it is revoked,
 * expires or reaches its use limit. Invites always grant the plain `member`
 * role, so a link can never be used to hand out moderator/admin powers.
 */
const CommunityInviteSchema = new mongoose.Schema({
  code:        { type: String, required: true, unique: true, trim: true, maxlength: 32 },
  communityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Community', required: true, index: true },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role:        { type: String, enum: ['member'], default: 'member' },
  // 0 means "no limit". Capped so a leaked link cannot add thousands of people.
  maxUses:     { type: Number, default: 0, min: 0, max: 100 },
  uses:        { type: Number, default: 0, min: 0 },
  expiresAt:   { type: Date, default: null },
  revokedAt:   { type: Date, default: null },
  // When true, following the link files a join request instead of adding the
  // person immediately. A manager then approves or declines in Invite people.
  requiresApproval: { type: Boolean, default: false }
}, { timestamps: true });

CommunityInviteSchema.index({ communityId: 1, createdAt: -1 });

module.exports = mongoose.model('CommunityInvite', CommunityInviteSchema);
