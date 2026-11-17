/**
 * Canonical game identity.
 *
 * The same game is written by players in five unrelated places, so every title
 * has to answer one question: "which row is this?" The pure helpers here do
 * that without a database (and are unit-tested); the functions below them add
 * the upsert/merge behaviour the controllers need.
 *
 * Identity is deliberately conservative: case, accents, punctuation and a
 * small set of edition suffixes are ignored. Anything stronger (fuzzy matching)
 * would silently merge two different games, which is worse than a duplicate an
 * admin can merge by hand.
 */
const mongoose = require('mongoose');
const Game = require('../models/Game');

const EDITION_SUFFIX = /\b(game of the year|goty|definitive|deluxe|ultimate|complete|enhanced|remastered|remake|anniversary)\b[\s\S]*$/i;

/** Accent- and punctuation-insensitive form used for comparison. */
function gameKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Key used to decide whether two titles are the same game. Edition suffixes are
 * dropped, so "Elden Ring: Shadow of the Erdtree Edition" still resolves to
 * "Elden Ring".
 */
function canonicalKey(value) {
  const key = gameKey(value);
  if (!key) return '';
  const stripped = key.replace(EDITION_SUFFIX, '').trim();
  return stripped || key;
}

/** URL-safe slug. Kept from the full key so different editions stay distinct. */
function slugify(value) {
  return gameKey(value).replace(/ /g, '-').slice(0, 80);
}

function yearFrom(value) {
  const year = Number(String(value || '').slice(0, 4));
  return Number.isInteger(year) && year >= 1950 && year <= 2100 ? year : null;
}

/** Shape a row without touching the database. */
function buildGameRecord({
  title,
  source = 'user',
  status = 'provisional',
  summary = '',
  cover = null,
  screenshots = [],
  genres = [],
  platforms = [],
  releaseDate = null,
  requirements = null,
  externalIds = {},
  stats = null,
  now = new Date()
} = {}) {
  const cleanTitle = String(title || '').trim().slice(0, 160);
  const key = canonicalKey(cleanTitle);
  if (!cleanTitle || !key) return null;

  return {
    title: cleanTitle,
    key,
    slug: slugify(cleanTitle) || `game-${Date.now().toString(36)}`,
    aliases: [],
    aliasKeys: [],
    summary: String(summary || '').slice(0, 4000),
    cover: cover || { url: null, imageId: null },
    screenshots: (Array.isArray(screenshots) ? screenshots : []).filter(Boolean).slice(0, 8),
    genres: [...new Set((Array.isArray(genres) ? genres : []).filter(Boolean))].slice(0, 8),
    platforms: [...new Set((Array.isArray(platforms) ? platforms : []).filter(Boolean))].slice(0, 10),
    releaseYear: yearFrom(releaseDate),
    requirements: requirements || {},
    externalIds: externalIds || {},
    stats: stats || {},
    source,
    status,
    lastSyncedAt: now,
    schemaVersion: 1
  };
}

/** Sum the counters of two rows; used when an admin merges a duplicate. */
function mergeStats(primaryStats = {}, duplicateStats = {}) {
  const keys = ['favoriteCount', 'squadCount', 'serverCount', 'postCount', 'playerCount'];
  const merged = {};
  for (const key of keys) {
    merged[key] = Math.max(0, Number(primaryStats[key] || 0) + Number(duplicateStats[key] || 0));
  }
  return merged;
}

function mergeGameDocuments(primary, duplicate) {
  if (!primary || !duplicate) return primary;
  const aliasKeys = new Set([
    ...(primary.aliasKeys || []),
    ...(duplicate.aliasKeys || []),
    duplicate.key
  ].filter(Boolean));
  aliasKeys.delete(primary.key);

  const aliases = [...new Set([
    ...(primary.aliases || []),
    ...(duplicate.aliases || []),
    duplicate.title
  ].filter((value) => value && value !== primary.title))];

  return {
    ...primary,
    aliases,
    aliasKeys: [...aliasKeys],
    screenshots: [...new Set([...(primary.screenshots || []), ...(duplicate.screenshots || [])])].slice(0, 8),
    genres: [...new Set([...(primary.genres || []), ...(duplicate.genres || [])])],
    platforms: [...new Set([...(primary.platforms || []), ...(duplicate.platforms || [])])],
    stats: mergeStats(primary.stats, duplicate.stats),
    summary: primary.summary || duplicate.summary || ''
  };
}

/** Titles a player has explicitly chosen, across both preference surfaces. */
function collectPlayerTitles(user) {
  return [
    ...(Array.isArray(user?.preferences?.favoriteGames) ? user.preferences.favoriteGames : []),
    ...(Array.isArray(user?.gamerPassport?.activeGames)
      ? user.gamerPassport.activeGames.map((entry) => entry?.gameName)
      : [])
  ].filter(Boolean);
}

/**
 * Find the row a title refers to, including merged duplicates.
 * `mergedInto` is followed one hop: merges are not chained by the admin tool.
 */
async function findGameByTitle(title, { includeMerged = false } = {}) {
  const key = canonicalKey(title);
  if (!key) return null;

  const query = { $or: [{ key }, { aliasKeys: key }] };
  if (!includeMerged) query.status = { $ne: 'merged' };

  return Game.findOne(query).sort({ 'stats.favoriteCount': -1 }).lean();
}

/**
 * Resolve a free-text title to a row, creating a provisional one when needed.
 *
 * The unique `key` index is the arbiter under concurrency: two simultaneous
 * first-time resolutions produce one insert and one duplicate-key error, which
 * is retried as a read. `slug` collisions between distinct keys (rare) retry
 * with a numeric suffix.
 */
async function resolveGame(title, { source = 'user', now = new Date() } = {}) {
  const existing = await findGameByTitle(title);
  if (existing) return existing;

  const base = buildGameRecord({ title, source, status: 'provisional', now });
  if (!base) return null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? base.slug : `${base.slug}-${attempt + 1}`;
    try {
      return await Game.findOneAndUpdate(
        { key: base.key },
        { $setOnInsert: { ...base, slug } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean();
    } catch (err) {
      if (err?.code !== 11000) throw err;
      // Either the key now exists (retry as a read) or the slug is taken.
      const raced = await findGameByTitle(title);
      if (raced) return raced;
    }
  }
  return null;
}

/**
 * Reconcile the favourite-game counter after a preference change.
 * `added`/`removed` are computed from the before/after arrays, so a re-save of
 * the same list never inflates the counter.
 */
async function applyFavoriteGameChange(previousTitles = [], nextTitles = []) {
  const before = new Set((previousTitles || []).map(canonicalKey).filter(Boolean));
  const after = new Set((nextTitles || []).map(canonicalKey).filter(Boolean));

  const added = [...after].filter((key) => !before.has(key));
  const removed = [...before].filter((key) => !after.has(key));

  const resolveKey = async (key) => {
    const direct = await Game.findOne({ $or: [{ key }, { aliasKeys: key }], status: { $ne: 'merged' } })
      .select('_id')
      .lean();
    return direct?._id || null;
  };

  const increments = [];
  for (const key of added) {
    const id = await resolveKey(key);
    if (id) increments.push({ id, delta: 1 });
  }
  for (const key of removed) {
    const id = await resolveKey(key);
    if (id) increments.push({ id, delta: -1 });
  }

  if (!increments.length) return { added: added.length, removed: removed.length };

  await Game.bulkWrite(
    increments.map(({ id, delta }) => ({
      updateOne: {
        filter: { _id: id },
        update: { $inc: { 'stats.favoriteCount': delta } }
      }
    })),
    { ordered: false }
  );

  // A counter should never go negative even if a document was edited by hand.
  await Game.updateMany({ 'stats.favoriteCount': { $lt: 0 } }, { $set: { 'stats.favoriteCount': 0 } });

  return { added: added.length, removed: removed.length };
}

/** Resolve every supplied title, used when onboarding or preferences are saved. */
async function resolveGameTitles(titles = [], { source = 'user' } = {}) {
  const resolved = [];
  for (const title of [...new Set((titles || []).filter(Boolean))].slice(0, 20)) {
    const game = await resolveGame(title, { source });
    if (game) resolved.push(game);
  }
  return resolved;
}

module.exports = {
  EDITION_SUFFIX,
  gameKey,
  canonicalKey,
  slugify,
  yearFrom,
  buildGameRecord,
  mergeStats,
  mergeGameDocuments,
  collectPlayerTitles,
  findGameByTitle,
  resolveGame,
  resolveGameTitles,
  applyFavoriteGameChange
};
