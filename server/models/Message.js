const mongoose = require('mongoose');

/** One reaction slot: a canonical short code and the users who picked it. */
const reactionSchema = new mongoose.Schema({
  emoji: {
    type: String,
    required: true,
    // Short codes only (see utils/reactions.js) — never raw client markup.
    maxlength: 16
  },
  users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { _id: false });

/**
 * Reply context captured at send time.
 * The preview is a snapshot, so a reply still shows what it answered after the
 * original is tombstoned or deleted — the deleted body itself is never exposed.
 */
const replyToSchema = new mongoose.Schema({
  messageId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  senderName: { type: String, default: null, maxlength: 20 },
  preview:    { type: String, default: null, maxlength: 120 }
}, { _id: false });

const mentionSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  username: { type: String, required: true, maxlength: 20 }
}, { _id: false });

const MessageSchema = new mongoose.Schema({
  channelId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Channel',
    required: true,
    index: true
  },

  communityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Community',
    required: true,
    index: true
  },

  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Empty only for attachment-only messages; the socket enforces "text or file".
  text: {
    type: String,
    default: '',
    trim: true,
    maxlength: 1000
  },

  pinned: { type: Boolean, default: false },

  reactions: { type: [reactionSchema], default: [] },
  replyTo:   { type: replyToSchema, default: null },
  mentions:  { type: [mentionSchema], default: [] },
  attachments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Attachment' }],

  // GDPR Right to Erasure & Tombstone support
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Edit tracking
  isEdited: { type: Boolean, default: false },
  editedAt: { type: Date, default: null }

}, { timestamps: true });

// Index for paginated channel history fetch (newest first)
MessageSchema.index({ channelId: 1, createdAt: -1 });

// Pinned-message tray
MessageSchema.index({ channelId: 1, pinned: 1, createdAt: -1 });

// Permission-scoped message search. MongoDB allows one text index per
// collection; every search query is additionally filtered by channelId, so a
// hit can never come from a channel the caller cannot read.
MessageSchema.index({ text: 'text' }, { name: 'message_text_search' });

module.exports = mongoose.model('Message', MessageSchema);
