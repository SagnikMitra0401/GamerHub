/**
 * Input sanitisation helpers.
 *
 * Chat text is stored RAW (React escapes on render). What we remove here are
 * characters that can corrupt transports, logs or the DOM:
 *   - C0/C1 control characters except \n and \t
 *   - bidirectional overrides (can spoof names/messages)
 *   - zero-width characters (can hide content from moderators)
 *   - overly long runs of blank lines / total length
 */

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const BIDI_OVERRIDES = /[\u202A-\u202E\u2066-\u2069]/g;
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;
const BLANK_LINE_RUN = /\n{3,}/g;

/**
 * Normalise a chat message.
 * @returns {{ok: boolean, text?: string, reason?: string}}
 */
function normalizeMessageText(raw, policy) {
  const { minLength, maxLength, maxLines } = policy.message;

  if (typeof raw !== 'string') return { ok: false, reason: 'Message must be text.' };

  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(BIDI_OVERRIDES, '')
    .replace(ZERO_WIDTH, '')
    .replace(BLANK_LINE_RUN, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();

  if (text.length < minLength) return { ok: false, reason: 'Message cannot be empty.' };
  if (text.length > maxLength) {
    return { ok: false, reason: `Message must be ${maxLength} characters or fewer.` };
  }
  if (text.split('\n').length > maxLines) {
    return { ok: false, reason: `Message must be ${maxLines} lines or fewer.` };
  }
  return { ok: true, text };
}

/** Multi-line text (post bodies, comments) with control characters removed. */
function sanitizeText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(BIDI_OVERRIDES, '')
    .replace(ZERO_WIDTH, '')
    .replace(BLANK_LINE_RUN, '\n\n')
    .trim()
    .slice(0, maxLength);
}

/** Escape a user string for safe use inside a RegExp. */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Single-line user-visible string (names, topics, tags). */
function sanitizeLine(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .replace(CONTROL_CHARS, '')
    .replace(BIDI_OVERRIDES, '')
    .replace(ZERO_WIDTH, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Is this a safe http(s) URL (no javascript:, data:, etc.)? */
function isHttpUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate a link preview before persisting it.
 * Never trust the client: only the four known fields survive, URLs must be
 * http(s), strings are trimmed and length-capped.
 */
function sanitizeLinkPreview(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const url = String(payload.url || '').trim();
  if (!isHttpUrl(url)) return null;

  const image = payload.image ? String(payload.image).trim() : '';
  return {
    url: url.slice(0, 2048),
    title: sanitizeLine(payload.title, 200) || null,
    description: sanitizeLine(payload.description, 500) || null,
    image: isHttpUrl(image) ? image.slice(0, 2048) : null,
    siteName: sanitizeLine(payload.siteName, 80) || null
  };
}

/** Normalise a list of post tags. */
function normalizeTags(input) {
  const list = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];

  const seen = new Set();
  const tags = [];
  for (const raw of list) {
    const tag = sanitizeLine(String(raw ?? ''), 24).toLowerCase().replace(/^#/, '');
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= 10) break;
  }
  return tags;
}

module.exports = {
  normalizeMessageText,
  sanitizeLine,
  sanitizeText,
  escapeRegex,
  isHttpUrl,
  sanitizeLinkPreview,
  normalizeTags
};
