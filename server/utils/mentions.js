/**
 * @mention parsing.
 *
 * Only two things are ever resolved: usernames that exist in the community the
 * message was sent to, and the literal `@everyone` token (which requires the
 * MENTION_EVERYONE capability). Nothing the client says about identity is
 * trusted — the mention list is rebuilt from text plus the member list.
 */

const { sanitizeLine } = require('./sanitize');

const MAX_MENTIONS_PER_MESSAGE = 5;
// The leading `[^\w@]` (or start of string) keeps `john@example.com` from
// pinging a member called `example`.
const USERNAME_PATTERN = /(?:^|[^\w@])@([a-zA-Z0-9_]{3,20})(?![\w])/g;
const EVERYONE_PATTERN = /(^|\s)@everyone\b/i;

/** Every `@name` token in the message, de-duplicated, casing preserved. */
function extractMentionNames(text) {
  if (typeof text !== 'string') return [];
  const names = new Map();
  for (const match of text.matchAll(USERNAME_PATTERN)) {
    const key = match[1].toLowerCase();
    if (!names.has(key)) names.set(key, match[1]);
  }
  return [...names.values()];
}

/** The single-line quote stored on a reply, capped so a message cannot smuggle a wall of text in. */
function replyPreview(text, maxLength = 120) {
  const line = sanitizeLine(text, maxLength);
  return line || null;
}

const mentionsEveryone = (text) => (typeof text === 'string' ? EVERYONE_PATTERN.test(text) : false);

module.exports = {
  MAX_MENTIONS_PER_MESSAGE,
  extractMentionNames,
  replyPreview,
  mentionsEveryone
};
