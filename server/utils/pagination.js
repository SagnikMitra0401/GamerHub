/** Safe query-string parsing for paginated endpoints (NaN-proof). */

const DEFAULT_LIMIT = 15;
const DEFAULT_MAX_LIMIT = 50;

/**
 * @returns {{page: number, limit: number, skip: number}}
 */
function parsePagination(query = {}, { defaultLimit = DEFAULT_LIMIT, maxLimit = DEFAULT_MAX_LIMIT } = {}) {
  const rawPage = Number(query.page);
  const rawLimit = Number(query.limit);

  const page = Number.isFinite(rawPage) ? Math.min(Math.max(Math.trunc(rawPage), 1), 10_000) : 1;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), maxLimit)
    : defaultLimit;

  return { page, limit, skip: (page - 1) * limit };
}

/** Cursor parser for `_id`-based pagination. Returns null when absent/invalid. */
function parseObjectIdCursor(value, mongoose) {
  if (!value || typeof value !== 'string') return null;
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null;
}

module.exports = { parsePagination, parseObjectIdCursor };
