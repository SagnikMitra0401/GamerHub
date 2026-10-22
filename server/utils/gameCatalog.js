/**
 * Game catalog backed by the public FreeToGame API.
 *
 * The whole list is fetched at most once per 10 minutes and searched in memory,
 * so browsing/filtering never hammers the upstream. No API key is involved.
 */
const { createTtlCache } = require('./cache');
const { fetchJson } = require('./outbound');
const { sanitizeLine, sanitizeText, decodeHtmlEntities } = require('./sanitize');

const API_BASE = 'https://www.freetogame.com/api';
const CACHE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 7000;
const MAX_RESULTS = 60;

const cache = createTtlCache({ ttlMs: CACHE_TTL_MS, maxEntries: 40 });
let lastGood = null;

const httpsOnly = (url) => (typeof url === 'string' && /^https:\/\//i.test(url) ? url : null);
const httpOrHttps = (url) =>
  typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;

function normalizeGame(raw = {}) {
  return {
    id: Number(raw.id),
    title: sanitizeLine(raw.title, 120),
    thumbnail: httpOrHttps(raw.thumbnail),
    shortDescription: sanitizeLine(decodeHtmlEntities(raw.short_description), 300),
    genre: sanitizeLine(raw.genre, 40),
    platform: sanitizeLine(raw.platform, 40),
    publisher: sanitizeLine(raw.publisher, 80),
    developer: sanitizeLine(raw.developer, 80),
    releaseDate: sanitizeLine(raw.release_date, 20),
    gameUrl: httpsOnly(raw.game_url),
    profileUrl: httpsOnly(raw.freetogame_profile_url)
  };
}

async function loadCatalog() {
  try {
    const data = await fetchJson(`${API_BASE}/games`, { timeoutMs: TIMEOUT_MS });
    const games = (Array.isArray(data) ? data : [])
      .map(normalizeGame)
      .filter((g) => Number.isFinite(g.id) && g.id > 0 && g.title);

    if (!games.length) throw new Error('Catalog came back empty');

    lastGood = { games, fetchedAt: new Date().toISOString(), stale: false };
    return lastGood;
  } catch (err) {
    // Serve the previous snapshot rather than breaking the page entirely.
    if (lastGood) {
      return { ...lastGood, stale: true, error: err.message };
    }
    throw err;
  }
}

/** @returns {Promise<{games: object[], fetchedAt: string, stale: boolean}>} */
const getCatalog = () => cache.wrap('catalog', loadCatalog, CACHE_TTL_MS);

/** In-memory search/filter over an already-normalised catalog. */
function searchGames(games, { q = '', genre = '', platform = '', limit = MAX_RESULTS } = {}) {
  const needle = sanitizeLine(q, 60).toLowerCase();
  const wantGenre = sanitizeLine(genre, 40).toLowerCase();
  const wantPlatform = sanitizeLine(platform, 40).toLowerCase();

  return (Array.isArray(games) ? games : [])
    .filter((game) => {
      if (wantGenre && game.genre.toLowerCase() !== wantGenre) return false;
      if (wantPlatform && game.platform.toLowerCase() !== wantPlatform) return false;
      if (!needle) return true;
      return (
        game.title.toLowerCase().includes(needle) ||
        game.genre.toLowerCase().includes(needle) ||
        game.publisher.toLowerCase().includes(needle) ||
        game.developer.toLowerCase().includes(needle)
      );
    })
    .slice(0, Math.min(Math.max(Number(limit) || MAX_RESULTS, 1), MAX_RESULTS));
}

function distinctGenres(games) {
  return [...new Set((games || []).map((g) => g.genre).filter(Boolean))].sort();
}

async function getGameDetail(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;

  return cache.wrap(`game:${numericId}`, async () => {
    const raw = await fetchJson(`${API_BASE}/game?id=${numericId}`, { timeoutMs: TIMEOUT_MS });
    if (!raw || !raw.id) return null;

    const requirements = raw.minimum_system_requirements || {};
    return {
      ...normalizeGame(raw),
      description: sanitizeText(decodeHtmlEntities(raw.description), 4000),
      status: sanitizeLine(raw.status, 40),
      screenshots: (Array.isArray(raw.screenshots) ? raw.screenshots : [])
        .map((shot) => httpOrHttps(shot?.image))
        .filter(Boolean)
        .slice(0, 6),
      minimumSystemRequirements: {
        os: sanitizeLine(requirements.os, 120),
        processor: sanitizeLine(requirements.processor, 120),
        memory: sanitizeLine(requirements.memory, 60),
        graphics: sanitizeLine(requirements.graphics, 120),
        storage: sanitizeLine(requirements.storage, 60)
      }
    };
  }, CACHE_TTL_MS);
}

/** Test helper. */
function clearCatalogCache() {
  cache.clear();
  lastGood = null;
}

module.exports = {
  getCatalog,
  searchGames,
  distinctGenres,
  getGameDetail,
  normalizeGame,
  clearCatalogCache,
  CACHE_TTL_MS,
  MAX_RESULTS
};
