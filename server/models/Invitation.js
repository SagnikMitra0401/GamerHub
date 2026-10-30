const mongoose = require('mongoose');

/**
 * Consent-driven invitation.
 *
 * Nobody is ever silently added to a squad or a server: an invitation is a
 * record the recipient must accept. The state machine is
 * pending -> accepted | declined | expired | revoked, and `pending` is a
 * terminal-free state guarded by a partial unique index so the same person
 * cannot be spammed with duplicate invites for the same target.
 *
 * This collection stays on the primary connection because accepting an
 * invitation mutates Party/Community documents and needs their schema.
 */
const INVITE_TTL_DAYS = 7;

const InvitationSchema = new mongoose.Schema({
  inviterUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  inviterUsername: { type: String, default: '', trim: true, maxlength: 20 },
  recipientUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  targetType: {
    type: String,
    enum: ['squad', 'community_server'],
    required: true
  },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
  // Snapshot of the target's display name, so the inbox renders even if the
  // squad has since expired.
  targetName: { type: String, default: '', trim: true, maxlength: 80 },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined', 'expired', 'revoked'],
    default: 'pending',
    index: true
  },
  message: { type: String, trim: true, maxlength: 200, default: '' },
  expiresAt: { type: Date, required: true, index: true },
  respondedAt: { type: Date, default: null }
}, { timestamps: true });

InvitationSchema.index({ recipientUserId: 1, status: 1, createdAt: -1 });
// One live invitation per recipient + target; a re-invite after a decline is
// allowed (the partial filter only covers `pending`).
InvitationSchema.index(
  { recipientUserId: 1, targetType: 1, targetId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);

module.exports = mongoose.model('Invitation', InvitationSchema);
module.exports.INVITE_TTL_DAYS = INVITE_TTL_DAYS;
