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

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * Decode HTML entities in third-party metadata (YouTube titles, game
 * descriptions). Single pass, so `&amp;lt;` becomes `&lt;` and never `<`.
 */
function decodeHtmlEntities(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const num = code[1].toLowerCase() === 'x'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      if (!Number.isFinite(num) || num <= 0 || num > 0x10ffff) return match;
      try {
        return String.fromCodePoint(num);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
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

/**
 * Hashtag-style tags, the way Instagram treats them:
 *   - a tag is `#` + letters/numbers/underscores, so it never contains spaces
 *   - case is not significant: #EldenRing and #eldenring are one tag
 *   - a post carries at most 10 tags, each at most 24 characters
 *   - the stored value never includes the leading `#`
 */
const TAG_MAX_LENGTH = 24;
const MAX_TAGS = 10;

const URL_PATTERN = /\bhttps?:\/\/\S+/gi;
const HASHTAG_PATTERN = /(^|[^\p{L}\p{N}_#])#([\p{L}\p{N}_][\p{L}\p{N}_-]{0,23})/gu;

/** Case- and separator-insensitive identity: "Battle Royale" === "#battleroyale". */
function tagKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Canonical stored form of one tag: lowercase, no `#`, spaces kept between words. */
function cleanTag(value) {
  return sanitizeLine(String(value ?? ''), TAG_MAX_LENGTH)
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}_ -]/gu, '')
    .replace(/[\s_]+/g, ' ')
    .trim()
    .slice(0, TAG_MAX_LENGTH)
    .trim();
}

/** Every inline #tag in the supplied text blocks (URLs are ignored). */
function extractHashtags(...texts) {
  const found = [];
  for (const raw of texts) {
    if (typeof raw !== 'string' || !raw) continue;
    const text = raw.replace(URL_PATTERN, ' ');
    for (const match of text.matchAll(HASHTAG_PATTERN)) {
      const tag = cleanTag(match[2]);
      if (tag) found.push(tag);
    }
  }
  return found;
}

/** Normalise a list of post tags (input may already contain inline #tags). */
function normalizeTags(input) {
  let source = input;

  // Multipart post creation sends the array as a JSON string because FormData
  // has no array field. Accept that form as well as a plain comma list.
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) source = parsed;
      } catch {
        // Not JSON: keep the comma-separated fallback.
      }
    }
  }

  const list = Array.isArray(source)
    ? source
    : typeof source === 'string'
      ? source.split(',')
      : [];

  const seen = new Set();
  const tags = [];
  for (const raw of list) {
    // A single input entry may itself be a sentence with several hashtags;
    // when it is, only the hashtags are tags — never the surrounding words.
    const inline = typeof raw === 'string' && raw.includes('#') ? extractHashtags(raw) : [];
    const candidates = inline.length ? inline : [raw];
    for (const candidate of candidates) {
      const tag = cleanTag(candidate);
      const key = tagKey(tag);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
      if (tags.length >= MAX_TAGS) return tags;
    }
  }
  return tags;
}

module.exports = {
  normalizeMessageText,
  sanitizeLine,
  decodeHtmlEntities,
  sanitizeText,
  escapeRegex,
  isHttpUrl,
  sanitizeLinkPreview,
  normalizeTags,
  extractHashtags,
  tagKey,
  cleanTag
};
