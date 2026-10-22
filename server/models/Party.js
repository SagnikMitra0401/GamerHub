const mongoose = require('mongoose');
const { Schema } = mongoose;

/** Squads disappear from the board (and the database) after 6 hours. */
const PARTY_TTL_MS = 6 * 60 * 60 * 1000;
const MIN_SLOTS = 2;
const MAX_SLOTS = 6;

const PartySchema = new Schema({
  gameTitle: {
    type: String,
    required: true,
    trim: true,
    maxlength: 60,
    index: true
  },
  gameThumbnail: {
    type: String,
    default: null // only ever an http(s) URL supplied by the catalog
  },
  activity: {
    type: String,
    default: '',
    trim: true,
    maxlength: 60
  },
  leaderId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  maxSlots: {
    type: Number,
    min: MIN_SLOTS,
    max: MAX_SLOTS,
    default: 5
  },
  members: [{
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['leader', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now }
  }],
  requests: [{
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, default: '', trim: true, maxlength: 200 },
    requestedAt: { type: Date, default: Date.now }
  }],
  requirements: {
    minRank: { type: String, default: '', trim: true, maxlength: 20 },
    micRequired: { type: Boolean, default: false }
  },
  status: {
    type: String,
    enum: ['open', 'full', 'closed'],
    default: 'open',
    index: true
  },
  // TTL index: Mongo removes the document at this point, so a stale squad can
  // never linger on the board.
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + PARTY_TTL_MS),
    index: { expires: 0 }
  }
}, { timestamps: true });

PartySchema.index({ status: 1, createdAt: -1 });

PartySchema.virtual('openSlots').get(function () {
  return Math.max(0, this.maxSlots - (this.members?.length || 0));
});

PartySchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Party', PartySchema);
