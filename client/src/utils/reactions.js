/**
 * Client mirror of server/utils/reactions.js.
 *
 * The server stores short codes; the glyphs live here. Adding a reaction is a
 * two-line change in both files, and the server remains the gatekeeper — an
 * unknown code sent by an old client is rejected, not rendered.
 */

const REACTIONS = Object.freeze([
  { code: 'gg',     glyph: '🎮', label: 'GG' },
  { code: 'fire',   glyph: '🔥', label: 'Fire' },
  { code: 'heart',  glyph: '💜', label: 'Love' },
  { code: 'laugh',  glyph: '😄', label: 'Laugh' },
  { code: 'wow',    glyph: '😮', label: 'Wow' },
  { code: 'skull',  glyph: '💀', label: 'RIP' },
  { code: 'clap',   glyph: '👏', label: 'Clap' },
  { code: 'target', glyph: '🎯', label: "Bullseye" }
]);

const BY_CODE = new Map(REACTIONS.map(reaction => [reaction.code, reaction]));

export const QUICK_REACTIONS = Object.freeze(['gg', 'fire', 'heart', 'laugh', 'skull']);

export const reactionGlyph = (code) => BY_CODE.get(code)?.glyph || '•';
export const reactionLabel = (code) => BY_CODE.get(code)?.label || code;
