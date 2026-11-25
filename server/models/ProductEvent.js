const mongoose = require('mongoose');

/**
 * First-party product events for the activation funnel.
 *
 * This is deliberately a small append-only collection: no message bodies, email
 * addresses, tokens or IP addresses. `recordEvent()` validates the event name
 * and sanitises props before a document can be written.
 */
const PRODUCT_EVENT_NAMES = [
  'signup',
  'onboarding_started',
  'onboarding_completed',
  'onboarding_skipped',
  'first_join',
  'first_follow',
  'first_post',
  'first_comment',
  'first_message',
  'password_reset_requested',
  'password_reset_completed',
  'email_verified',
  'notification_opened',
  'notification_clicked',
];

// These describe a one-time milestone. A unique partial index makes the
// "first" guarantee real even when two requests arrive together.
const FIRST_EVENT_NAMES = [
  'onboarding_started',
  'onboarding_completed',
  'onboarding_skipped',
  'first_join',
  'first_follow',
  'first_post',
  'first_comment',
  'first_message',
];

const PRODUCT_EVENT_TTL_DAYS = 180;
const PRODUCT_EVENT_TTL_SECONDS = PRODUCT_EVENT_TTL_DAYS * 24 * 60 * 60;

const ProductEventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    name: {
      type: String,
      enum: PRODUCT_EVENT_NAMES,
      required: true,
    },
    props: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Funnel queries by event name and time.
ProductEventSchema.index({ name: 1, createdAt: -1 });
// Per-user history and the erasure/export paths.
ProductEventSchema.index({ userId: 1, createdAt: -1 });
// First-only milestones. A partial unique index leaves repeatable events
// (notification opens, password resets) free to appear many times.
ProductEventSchema.index(
  { userId: 1, name: 1 },
  {
    unique: true,
    name: 'product_events_first_unique',
    partialFilterExpression: { name: { $in: FIRST_EVENT_NAMES } },
  },
);
// Analytics data has a bounded life: 180 days, then Mongo reclaims it.
ProductEventSchema.index(
  { createdAt: 1 },
  { name: 'product_events_ttl', expireAfterSeconds: PRODUCT_EVENT_TTL_SECONDS },
);

const ProductEvent = mongoose.model('ProductEvent', ProductEventSchema);

module.exports = ProductEvent;
module.exports.PRODUCT_EVENT_NAMES = PRODUCT_EVENT_NAMES;
module.exports.FIRST_EVENT_NAMES = FIRST_EVENT_NAMES;
module.exports.PRODUCT_EVENT_TTL_DAYS = PRODUCT_EVENT_TTL_DAYS;
module.exports.PRODUCT_EVENT_TTL_SECONDS = PRODUCT_EVENT_TTL_SECONDS;
