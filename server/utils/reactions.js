/**
 * Reaction catalogue.
 *
 * Reactions are stored as canonical short codes, never as client-supplied
 * strings or markup. A short allowlist means a hostile client cannot use
 * reactions as storage for URLs, script payloads or arbitrary 12KB strings, and
 * every client renders the same glyph because the mapping lives on the client.
 */

const REACTION_CODES = Object.freeze([
  'gg', 'fire', 'heart', 'laugh', 'wow', 'skull', 'clap', 'target'
]);

/** Distinct reaction slots allowed on one message. */
const MAX_REACTIONS_PER_MESSAGE = 8;

/** Normalise and validate an incoming reaction code. Returns null when invalid. */
function normalizeReaction(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toLowerCase().slice(0, 16);
  return REACTION_CODES.includes(code) ? code : null;
}

/**
 * Public shape of a message's reactions.
 * User ids are never serialised to clients: a count plus the viewer's own flag
 * is everything the UI needs, and it keeps chat payloads small.
 *
 * @param {Array<{emoji: string, users: Array}>} reactions
 * @param {string|null} viewerId
 * @returns {Array<{emoji: string, count: number, mine: boolean}>}
 */
function serializeReactions(reactions = [], viewerId = null) {
  const me = viewerId ? String(viewerId) : null;
  return (reactions || [])
    .map((reaction) => {
      const users = reaction.users || [];
      return {
        emoji: reaction.emoji,
        count: users.length,
        mine: me ? users.some((user) => String(user?._id ?? user) === me) : false
      };
    })
    .filter((reaction) => reaction.count > 0);
}

module.exports = {
  REACTION_CODES,
  MAX_REACTIONS_PER_MESSAGE,
  normalizeReaction,
  serializeReactions
};
