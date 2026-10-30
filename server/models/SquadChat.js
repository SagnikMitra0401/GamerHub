const mongoose = require('mongoose');
const { squadModel } = require('../config/connections');

/**
 * Temporary squad chat.
 *
 * One per squad (`squadId` unique), created when the squad locks and expiring
 * 15 days later. `expiresAt` is rolled forward by the owner only, so a squad
 * that is still playing keeps its thread while a stale one stops existing and
 * its messages are purged by the retention worker.
 *
 * Lives on the dedicated squads connection (see config/connections.js): the
 * writes are bursty and must never starve the auth or feed pools. Nothing here
 * is populated across connections, so author names are snapshotted onto the
 * message documents instead.
 */
const SquadChatSchema = new mongoose.Schema({
  squadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Party',
    required: true,
    unique: true,
    index: true
  },
  ownerUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // Snapshot so the chat renders without a join on the identity connection.
  ownerUsername: { type: String, default: '', trim: true, maxlength: 20 },
  memberIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
  state: {
    type: String,
    enum: ['active', 'expired', 'closed'],
    default: 'active',
    index: true
  },
  expiresAt: { type: Date, required: true, index: true },
  lastRefreshedAt: { type: Date, default: Date.now },
  // Set once the retention sweep has removed the messages, so an old expired
  // chat is not re-scanned on every run.
  purgedAt: { type: Date, default: null },
  refreshCount: { type: Number, default: 0 },
  lifecycleVersion: { type: Number, default: 1 }
}, { timestamps: true });

SquadChatSchema.index({ state: 1, expiresAt: 1 });

module.exports = squadModel('SquadChat', SquadChatSchema);
