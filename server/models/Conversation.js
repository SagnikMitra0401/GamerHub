const mongoose = require('mongoose');

/**
 * A single 1:1 thread. `pairKey` guarantees one row per pair of accounts even
 * if two requests race; the loser gets a duplicate-key error and the service
 * resolves it by reading the winner.
 *
 * State machine:
 *   request --accept--> active --report/block--> blocked
 *      |                  |
 *      | decline          +-- erase account --> erased
 *      v
 *   declined --retryAfter elapsed--> request (reused)
 *      |
 *   expired --retryAfter elapsed--> request (reused)
 */
const ConversationSchema = new mongoose.Schema(
  {
    pairKey: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    participantIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      required: true,
      validate: {
        validator: value => Array.isArray(value) && value.length === 2,
        message: 'A conversation has exactly two participants.'
      }
    },
    initiatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    state: {
      type: String,
      enum: ['request', 'active', 'declined', 'expired', 'blocked', 'archived', 'erased'],
      default: 'request',
      index: true
    },

    // Why the sender had standing to start contact. Kept for moderation and so
    // the request card can say "via <server>" rather than a bare message.
    context: {
      type: String,
      enum: ['profile', 'post', 'community', 'squad'],
      default: 'profile'
    },
    contextId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
    },
    contextLabel: {
      type: String,
      default: '',
      trim: true,
      maxlength: 80
    },

    requestText: {
      type: String,
      default: '',
      maxlength: 600
    },

    // Structured first contact from a verified business. Personal requests
    // leave these null and keep the plain 300-character opener.
    requestIntent: {
      type: String,
      enum: ['collab', 'sponsorship', 'support', 'press', 'partnership', 'other', null],
      default: null
    },
    requestCompany: { type: String, default: '', maxlength: 80 },
    requestWebsite: { type: String, default: '', maxlength: 200 },
    requestBudgetBand: {
      type: String,
      enum: ['under_500', '500_2000', '2000_plus', null],
      default: null
    },
    requestTimeline: { type: String, default: '', maxlength: 40 },
    businessThread: { type: Boolean, default: false, index: true },

    // A request that matched the recipient's filters stays a request but is
    // removed from the Requests lane. The sender is never told it was filtered.
    filteredAt: { type: Date, default: null, index: true },
    filterReason: {
      type: String,
      enum: ['hidden_word', 'campaign', 'reputation', null],
      default: null
    },
    filterMatched: { type: String, default: '', maxlength: 24 },

    // SHA-256 of the normalised opener, used only to detect identical-text
    // campaigns. The text itself is still stored for the recipient to read.
    requestFingerprint: { type: String, default: '', index: true },
    requestExpiresAt: {
      type: Date,
      default: null,
      index: true
    },
    acceptedAt: { type: Date, default: null },

    declinedAt: { type: Date, default: null },
    blockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    blockedAt: { type: Date, default: null },
    retryAfter: { type: Date, default: null },

    lastRequestAt: { type: Date, default: null, index: true },
    lastMessageAt: { type: Date, default: null, index: true },
    // At most one away auto-reply per thread per day. The timestamp lives on
    // the conversation so a reconnect or a second tab cannot duplicate it.
    autoReplyAt: { type: Date, default: null },
    lastMessagePreview: { type: String, default: '', maxlength: 120 },

    // Per-user unread counters. A Map keeps the document small and lets a
    // message write use one atomic $inc instead of a read-modify-write.
    unreadCounts: {
      type: Map,
      of: Number,
      default: {}
    },

    // Private triage labels. `ownerId` scopes each label to one participant, so
    // the other side never sees the words a creator uses in their own inbox.
    labels: [{
      _id: false,
      ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      value: { type: String, required: true, trim: true, maxlength: 24 }
    }],

    mutedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    archivedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
  },
  { timestamps: true }
);

// Inbox: participant + active + sort by recency.
ConversationSchema.index({ participantIds: 1, state: 1, lastMessageAt: -1 });
// Request lane: recipient + pending + expiry sweep.
ConversationSchema.index({ recipientId: 1, state: 1, createdAt: -1 });
ConversationSchema.index({ state: 1, requestExpiresAt: 1 });
// Outgoing request lane and the per-day quota count.
ConversationSchema.index({ initiatorId: 1, state: 1, createdAt: -1 });
ConversationSchema.index({ initiatorId: 1, lastRequestAt: -1 });
// Filtered request lane and the identical-text campaign detector.
ConversationSchema.index({ recipientId: 1, state: 1, filteredAt: 1, createdAt: -1 });
ConversationSchema.index({ initiatorId: 1, requestFingerprint: 1, lastRequestAt: -1 });

ConversationSchema.statics.pairKeyFor = function pairKeyFor(a, b) {
  return [String(a), String(b)].sort().join(':');
};

module.exports = mongoose.model('Conversation', ConversationSchema);
