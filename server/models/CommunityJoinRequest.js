const mongoose = require('mongoose');

/**
 * A request to join a server through an invite link that requires approval.
 *
 * The link proves the person was invited; a manager still decides. Requests are
 * scoped to one invite so the audit log can say which link brought them in, and
 * a partial unique index keeps one pending request per person per server.
 */
const CommunityJoinRequestSchema = new mongoose.Schema({
  communityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Community', required: true, index: true },
  inviteId:    { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityInvite', required: true },
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  // Snapshot so the queue and the audit log render without a cross-collection join.
  username:    { type: String, default: '', trim: true, maxlength: 20 },
  message:     { type: String, default: '', trim: true, maxlength: 200 },
  status: {
    type: String,
    enum: ['pending', 'approved', 'denied', 'cancelled', 'expired'],
    default: 'pending',
    index: true
  },
  decidedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  decidedAt:   { type: Date, default: null }
}, { timestamps: true });

CommunityJoinRequestSchema.index({ communityId: 1, status: 1, createdAt: -1 });
// One live request per person per server; a denied request can be retried later.
CommunityJoinRequestSchema.index(
  { communityId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);

module.exports = mongoose.model('CommunityJoinRequest', CommunityJoinRequestSchema);
