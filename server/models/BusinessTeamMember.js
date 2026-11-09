const mongoose = require('mongoose');

/**
 * A shared business inbox membership.
 *
 * This is deliberately not a Conversation participant. `participantIds` stays
 * the two people actually talking; a teammate gets only the business threads
 * the owner explicitly shares, and only after accepting an invitation.
 */
const BusinessTeamMemberSchema = new mongoose.Schema(
  {
    businessOwnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    role: {
      type: String,
      enum: ['viewer', 'agent'],
      default: 'viewer'
    },
    status: {
      type: String,
      enum: ['invited', 'active', 'declined', 'removed'],
      default: 'invited',
      index: true
    },
    invitedById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    respondedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

BusinessTeamMemberSchema.index({ businessOwnerId: 1, memberId: 1 }, { unique: true });
BusinessTeamMemberSchema.index({ memberId: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model('BusinessTeamMember', BusinessTeamMemberSchema);
