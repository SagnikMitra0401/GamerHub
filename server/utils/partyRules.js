/**
 * LFG (looking-for-group) rules.
 *
 * Pure functions only — no database access — so the same rules are unit
 * testable and the controller stays thin.
 */

const { sanitizeLine, isHttpUrl } = require('./sanitize');

const MIN_SLOTS = 2;
const MAX_SLOTS = 6;
const DEFAULT_SLOTS = 5;
const MAX_REQUEST_MESSAGE = 200;

const idOf = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return String(value._id);
  return String(value);
};

/** How many seats are still free. */
function openSlots(party) {
  if (!party) return 0;
  const taken = Array.isArray(party.members) ? party.members.length : 0;
  const max = Number(party.maxSlots) || DEFAULT_SLOTS;
  return Math.max(0, max - taken);
}

const isExpired = (party, now = Date.now()) =>
  !!(party?.expiresAt && new Date(party.expiresAt).getTime() <= now);

/**
 * Validate + normalise a create-party payload.
 * @returns {{ok: boolean, errors: string[], value: object}}
 */
function normalizePartyInput(body = {}) {
  const errors = [];

  const gameTitle = sanitizeLine(body.gameTitle, 60);
  if (!gameTitle) errors.push('Pick a game for your squad.');

  const activity = sanitizeLine(body.activity, 60);

  const rawThumb = typeof body.gameThumbnail === 'string' ? body.gameThumbnail.trim() : '';
  const gameThumbnail = isHttpUrl(rawThumb) ? rawThumb.slice(0, 500) : null;

  const rawSlots = body.maxSlots === undefined ? DEFAULT_SLOTS : Number(body.maxSlots);
  const maxSlots = Number.isFinite(rawSlots) ? Math.trunc(rawSlots) : NaN;
  if (!Number.isInteger(maxSlots) || maxSlots < MIN_SLOTS || maxSlots > MAX_SLOTS) {
    errors.push(`Squad size must be between ${MIN_SLOTS} and ${MAX_SLOTS} players.`);
  }

  const requirements = body.requirements && typeof body.requirements === 'object'
    ? body.requirements
    : {};

  return {
    ok: errors.length === 0,
    errors,
    value: {
      gameTitle,
      gameThumbnail,
      activity,
      maxSlots,
      requirements: {
        minRank: sanitizeLine(requirements.minRank, 20),
        micRequired: !!requirements.micRequired
      }
    }
  };
}

/**
 * Can this user send a join request?
 * @returns {{ok: boolean, reason?: string}}
 */
function canRequestJoin(party, userId, now = Date.now()) {
  if (!party) return { ok: false, reason: 'Squad not found.' };

  if (isExpired(party, now)) {
    return { ok: false, reason: 'This squad has expired.' };
  }
  if (party.status !== 'open') {
    return {
      ok: false,
      reason: party.status === 'full' ? 'This squad is already full.' : 'This squad is no longer recruiting.'
    };
  }

  const id = String(userId);
  if (idOf(party.leaderId) === id) {
    return { ok: false, reason: 'You are the leader of this squad.' };
  }
  if ((party.members || []).some((m) => idOf(m.userId) === id)) {
    return { ok: false, reason: 'You are already in this squad.' };
  }
  if (openSlots(party) <= 0) {
    return { ok: false, reason: 'This squad is already full.' };
  }
  if ((party.requests || []).some((r) => idOf(r.userId) === id)) {
    return { ok: false, reason: 'You already asked to join this squad.' };
  }
  return { ok: true };
}

/** Squads the user leads or plays in (used to hide join buttons). */
function membershipOf(party, userId) {
  if (!party || !userId) return 'none';
  const id = String(userId);
  if (idOf(party.leaderId) === id) return 'leader';
  if ((party.members || []).some((m) => idOf(m.userId) === id)) return 'member';
  if ((party.requests || []).some((r) => idOf(r.userId) === id)) return 'pending';
  return 'none';
}

/** Squads that matched a board filter. */
function matchesFilters(party, filters = {}, now = Date.now()) {
  if (!party || party.status !== 'open' || isExpired(party, now)) return false;

  const game = sanitizeLine(filters.game, 60).toLowerCase();
  if (game && !String(party.gameTitle || '').toLowerCase().includes(game)) return false;

  if (filters.mic === '1' || filters.mic === 'true') {
    if (!party.requirements?.micRequired) return false;
  }
  if (filters.openSlots === '1' || filters.openSlots === 'true') {
    if (openSlots(party) <= 0) return false;
  }
  return true;
}

module.exports = {
  MIN_SLOTS,
  MAX_SLOTS,
  DEFAULT_SLOTS,
  MAX_REQUEST_MESSAGE,
  idOf,
  openSlots,
  isExpired,
  normalizePartyInput,
  canRequestJoin,
  membershipOf,
  matchesFilters
};
