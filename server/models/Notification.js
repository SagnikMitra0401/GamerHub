const mongoose = require('mongoose');
const { retentionAtFor } = require('../utils/notificationRetention');
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
  },
  // Set to createdAt + 15 days for ordinary pings. Important notices keep a
  // null value so the TTL index never removes them.
  retentionAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

// A TTL index on a nullable date only expires documents where the field is a
// real date. Durable notices therefore stay in place with `retentionAt: null`.
NotificationSchema.index(
  { retentionAt: 1 },
  { expireAfterSeconds: 0, name: 'notification_retention_ttl' }
);

NotificationSchema.pre('save', function setRetentionAt(next) {
  if (this.isNew && !this.retentionAt) this.retentionAt = retentionAtFor(this);
  next();
});

NotificationSchema.pre('insertMany', function setRetentionAtForMany(next, docs) {
  if (Array.isArray(docs)) {
    for (const doc of docs) {
      if (!doc.retentionAt) doc.retentionAt = retentionAtFor(doc);
    }
  }
  next();
});

NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index(
  { userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } }
);

module.exports = mongoose.model('Notification', NotificationSchema);
