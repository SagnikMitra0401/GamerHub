/**
 * Who must not appear in a caller's search results.
 *
 * Two different rules are combined here:
 *   - blocks are symmetric (either direction hides both people)
 *   - frozen or suspended accounts are hidden from everyone (but an admin may
 *     still see them elsewhere; search is not a moderation surface)
 *
 * The list is cached for a few seconds because the block query is a multikey
 * lookup that would otherwise run on every keystroke. Any action that changes
 * visibility must call `invalidateVisibility()` so a freeze or a fresh block is
 * effective on the very next request.
 */
const User = require('../models/User');
const { createTtlCache } = require('./cache');

const CACHE_TTL_MS = 15_000;
const visibilityCache = createTtlCache({ ttlMs: CACHE_TTL_MS, maxEntries: 200 });

/** Ids of accounts that blocked the caller. */
async function blockedByOthers(userId) {
  if (!userId) return [];
  const rows = await User.find({ blockedUsers: userId }).select('_id').lean();
  return rows.map((row) => String(row._id));
}

/**
 * Symmetric block set for a caller (empty for anonymous visitors).
 * @returns {Promise<string[]>}
 */
function blockedIdsFor(userId) {
  if (!userId) return Promise.resolve([]);
  return visibilityCache.wrap(`blocked:${userId}`, () => blockedByOthers(userId));
}

/**
 * Search filters need this synchronously in tests; expose the raw query too.
 * @returns {Promise<string[]>}
 */
async function hiddenAccountIds() {
  return visibilityCache.wrap('hidden-accounts', async () => {
    const rows = await User.find({ status: { $in: ['frozen', 'suspended'] } })
      .select('_id')
      .lean();
    return rows.map((row) => String(row._id));
  });
}

/** Drop every cached visibility decision (freeze, block, unblock, delete). */
function invalidateVisibility() {
  visibilityCache.clear();
}

module.exports = {
  CACHE_TTL_MS,
  blockedIdsFor,
  hiddenAccountIds,
  invalidateVisibility
};
