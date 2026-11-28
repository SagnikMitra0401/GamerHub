/** Safe query-string parsing for paginated endpoints (NaN-proof). */

const DEFAULT_LIMIT = 15;
const DEFAULT_MAX_LIMIT = 50;

/**
 * One page-size clamp for every list. A blank, zero or non-numeric value falls
 * back, anything else is floored and held between 1 and `max`.
 *
 * @param {unknown} value
 * @param {{fallback?: number, max?: number}} [options]
 * @returns {number}
 */
function parseLimit(value, { fallback = DEFAULT_LIMIT, max = DEFAULT_MAX_LIMIT } = {}) {
  const raw = Number(value);
  const amount = Number.isFinite(raw) && raw !== 0 ? Math.trunc(raw) : fallback;
  return Math.min(Math.max(amount, 1), max);
}

/**
 * @returns {{page: number, limit: number, skip: number}}
 */
function parsePagination(
  query = {},
  { defaultLimit = DEFAULT_LIMIT, maxLimit = DEFAULT_MAX_LIMIT } = {},
) {
  const rawPage = Number(query.page);

  const page = Number.isFinite(rawPage) ? Math.min(Math.max(Math.trunc(rawPage), 1), 10_000) : 1;
  const limit = parseLimit(query.limit, { fallback: defaultLimit, max: maxLimit });

  return { page, limit, skip: (page - 1) * limit };
}

/** Cursor parser for `_id`-based pagination. Returns null when absent/invalid. */
function parseObjectIdCursor(value, mongoose) {
  if (!value || typeof value !== 'string') return null;
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null;
}

module.exports = { parseLimit, parsePagination, parseObjectIdCursor };
