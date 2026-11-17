const ProductEvent = require('../models/ProductEvent');
const {
  PRODUCT_EVENT_NAMES,
  FIRST_EVENT_NAMES
} = ProductEvent;

const EVENT_NAMES = new Set(PRODUCT_EVENT_NAMES);
const FIRST_EVENTS = new Set(FIRST_EVENT_NAMES);

const MAX_PROPS = 10;
const MAX_KEY_LENGTH = 40;
const MAX_STRING_LENGTH = 120;
const SENSITIVE_KEY = /email|token|password|secret|authorization|cookie|(^|_)ip($|_)|address|message|text|body|content|stack/i;
const EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROP_KEY = /^[a-z][a-z0-9_]*$/i;

/**
 * Keep analytics props small and non-identifying.
 *
 * Unknown nested values, arrays, email-shaped values and keys that could carry
 * message content or credentials are silently dropped. The caller still gets a
 * useful event, just without the unsafe fields.
 */
function sanitizeEventProps(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  const clean = {};
  let count = 0;

  for (const [key, value] of Object.entries(input)) {
    if (count >= MAX_PROPS) break;
    if (typeof key !== 'string' || key.length > MAX_KEY_LENGTH || !PROP_KEY.test(key)) continue;
    if (SENSITIVE_KEY.test(key)) continue;

    if (typeof value === 'string') {
      const text = value.trim().slice(0, MAX_STRING_LENGTH);
      if (!text || EMAIL_VALUE.test(text)) continue;
      clean[key] = text;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      clean[key] = value;
    } else if (typeof value === 'boolean') {
      clean[key] = value;
    } else {
      continue;
    }

    count += 1;
  }

  // A defensive cap after string slicing; callers should not be able to turn
  // one event into a large document.
  if (JSON.stringify(clean).length > 1200) return {};
  return clean;
}

const isAllowedEventName = (name) =>
  typeof name === 'string' && EVENT_NAMES.has(name);

/**
 * Persist one event. Fire-and-forget by design: a telemetry failure must never
 * fail signup, a post or a message.
 */
async function recordEvent(name, userId = null, props = {}) {
  if (!isAllowedEventName(name)) return null;

  try {
    return await ProductEvent.create({
      userId: userId || null,
      name,
      props: sanitizeEventProps(props)
    });
  } catch (err) {
    if (err?.code !== 11000) {
      console.error(`[ProductEvents] ${name} failed:`, err.message);
    }
    return null;
  }
}

/**
 * Create a milestone at most once per user. The unique partial index is the
 * authority, so concurrent first actions cannot both win.
 */
async function recordFirstEvent(name, userId = null, props = {}) {
  if (!FIRST_EVENTS.has(name) || !userId) return null;

  try {
    await ProductEvent.updateOne(
      { userId, name },
      {
        $setOnInsert: {
          userId,
          name,
          props: sanitizeEventProps(props)
        }
      },
      { upsert: true }
    );
    return true;
  } catch (err) {
    // A duplicate means another request recorded the first milestone first.
    if (err?.code !== 11000) {
      console.error(`[ProductEvents] ${name} failed:`, err.message);
    }
    return false;
  }
}

module.exports = {
  isAllowedEventName,
  sanitizeEventProps,
  recordEvent,
  recordFirstEvent
};
