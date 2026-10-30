const mongoose = require('mongoose');
const { squadModel } = require('../config/connections');

/**
 * A message in a temporary squad chat.
 *
 * `authorUsername` / `authorLevel` are snapshots taken at send time: the chat
 * lives on its own connection, so a `populate('authorUserId')` would fail, and
 * a snapshot is also the right behaviour for a thread whose participants may
 * later leave or be erased.
 */
const SquadChatMessageSchema = new mongoose.Schema({
  chatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SquadChat',
    required: true,
    index: true
  },
  squadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Party',
    required: true,
    index: true
  },
  authorUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  authorUsername: { type: String, default: '', trim: true, maxlength: 20 },
  authorLevel: { type: Number, default: 1 },
  text: { type: String, required: true, trim: true, maxlength: 1000 },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

// Cursor pagination: newest first, `?before=<createdAt>`.
SquadChatMessageSchema.index({ chatId: 1, createdAt: -1 });

module.exports = squadModel('SquadChatMessage', SquadChatMessageSchema);
