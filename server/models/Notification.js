const mongoose = require('mongoose');
const { Schema } = mongoose;

const NOTIFICATION_TYPES = ['lfg_request', 'lfg_accepted', 'gaming_bot', 'social'];

const NotificationSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: NOTIFICATION_TYPES,
    default: 'social',
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },
  message: {
    type: String,
    default: '',
    trim: true,
    maxlength: 300
  },
  // Internal route (e.g. /lfg) or an external https link.
  actionUrl: {
    type: String,
    default: null,
    maxlength: 500
  },
  mediaThumbnail: {
    type: String,
    default: null,
    maxlength: 500
  },
  read: {
    type: Boolean,
    default: false,
    index: true
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  },
  // Idempotency key for generated pings ("yt:<videoId>"), so a re-sync never
  // produces duplicates. Partial index keeps ordinary pings free of it.
  dedupeKey: {
    type: String,
    default: undefined,
    maxlength: 200
  }
}, { timestamps: true });

NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index(
  { userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } }
);

module.exports = mongoose.model('Notification', NotificationSchema);
