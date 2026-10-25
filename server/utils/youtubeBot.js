/**
 * Gaming bot: watches YouTube for new videos about a player's favourite games
 * and turns them into notifications.
 *
 * The API key lives ONLY in the backend environment. It is never returned by an
 * endpoint, logged, or bundled into the client. Every upstream call goes through
 * a 30-minute cache so repeated syncs stay far inside the daily quota
 * (a search costs 100 units of 10,000/day, so cache hits are what make this
 * feature usable at all).
 */
const { cacheWrap } = require('./redisCache');
const { fetchJson } = require('./outbound');
const { notifyUser } = require('./notify');
const { sanitizeLine, decodeHtmlEntities } = require('./sanitize');

const API_BASE = 'https://www.googleapis.com/youtube/v3/search';
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_TTL_SECONDS = CACHE_TTL_MS / 1000;
const MAX_GAMES_PER_SYNC = 3;
const MAX_RESULTS = 3;
const LOOKBACK_DAYS = 30;
const TIMEOUT_MS = 6000;

// Search results are cached through redisCache (memory L1 + Upstash L2), so a
// deploy or Render restart no longer burns 100 quota units per game again.
// Bumped by resetYoutubeCache() so tests never see a previous case's hits.
let cacheEpoch = 0;

let lastSync = null; // { at, ok, created, message } — shown on the admin dashboard

const isConfigured = () => Boolean(process.env.YOUTUBE_API_KEY);

const httpsOnly = (url) => (typeof url === 'string' && /^https:\/\//i.test(url) ? url : null);

function pickThumbnail(snippet = {}) {
  const thumbs = snippet.thumbnails || {};
  return httpsOnly(thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url);
}

/**
 * Latest videos for one game title (cached).
 * @returns {Promise<Array<{videoId:string,title:string,channelTitle:string,publishedAt:string,thumbnail:string|null}>>}
 */
async function searchLatestVideos(gameTitle, { maxResults = MAX_RESULTS } = {}) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YOUTUBE_API_KEY is not configured');

  const query = sanitizeLine(`${gameTitle} gameplay`, 80);
  if (!query) throw new Error('Game title is empty');

  const cacheKey = `yt:search:v${cacheEpoch}:${query.toLowerCase()}:${maxResults}`;

  return cacheWrap(cacheKey, async () => {
    const publishedAfter = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
    const params = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      order: 'date',
      maxResults: String(maxResults),
      publishedAfter,
      q: query,
      key: apiKey
    });

    const data = await fetchJson(`${API_BASE}?${params.toString()}`, { timeoutMs: TIMEOUT_MS });
    const items = Array.isArray(data?.items) ? data.items : [];

    return items
      .map((item) => ({
        videoId: sanitizeLine(item.id?.videoId, 32),
        // YouTube returns HTML-escaped text ("&#39;") — decode before storing.
        title: sanitizeLine(decodeHtmlEntities(item.snippet?.title), 120),
        channelTitle: sanitizeLine(decodeHtmlEntities(item.snippet?.channelTitle), 80),
        publishedAt: item.snippet?.publishedAt || null,
        thumbnail: pickThumbnail(item.snippet)
      }))
      .filter((video) => video.videoId && video.title);
  }, CACHE_TTL_SECONDS);
}

/**
 * Create gaming-bot pings for one user's favourite games.
 * At most MAX_GAMES_PER_SYNC games (one newest video each) per call.
 */
async function syncUserNotifications(user) {
  const startedAt = Date.now();
  const result = { configured: isConfigured(), created: 0, games: [], errors: [] };

  if (!result.configured) {
    lastSync = { at: new Date().toISOString(), ok: false, created: 0, message: 'YOUTUBE_API_KEY is not set' };
    return result;
  }

  const userId = user?._id || user?.id;
  if (!userId) return result;

  const games = (user.preferences?.favoriteGames || [])
    .map((g) => sanitizeLine(g, 60))
    .filter(Boolean)
    .slice(0, MAX_GAMES_PER_SYNC);

  if (!games.length) {
    lastSync = { at: new Date().toISOString(), ok: true, created: 0, message: 'No favourite games yet' };
    return result;
  }

  for (const game of games) {
    result.games.push(game);
    try {
      const [latest] = await searchLatestVideos(game, { maxResults: 1 });
      if (!latest) continue;

      const notification = await notifyUser({
        userId,
        type: 'gaming_bot',
        title: `🤖 New ${game} video`,
        message: `${latest.title} — ${latest.channelTitle || 'YouTube'}`,
        actionUrl: `https://www.youtube.com/watch?v=${latest.videoId}`,
        mediaThumbnail: latest.thumbnail,
        metadata: {
          videoId: latest.videoId,
          gameTitle: game,
          channelTitle: latest.channelTitle,
          publishedAt: latest.publishedAt
        },
        dedupeKey: `yt:${latest.videoId}`
      });

      if (notification) result.created += 1;
    } catch (err) {
      result.errors.push({ game, message: err.message });
    }
  }

  lastSync = {
    at: new Date().toISOString(),
    ok: result.errors.length === 0,
    created: result.created,
    latencyMs: Date.now() - startedAt,
    message: result.errors.length ? result.errors[0].message : 'OK'
  };

  return result;
}

/** Admin-facing status — never includes the key itself. */
function getStatus() {
  return {
    configured: isConfigured(),
    lookbackDays: LOOKBACK_DAYS,
    cacheTtlMinutes: CACHE_TTL_MS / 60_000,
    cacheBackend: 'memory',
    maxGamesPerSync: MAX_GAMES_PER_SYNC,
    estimatedQuotaUnitsPerSync: MAX_GAMES_PER_SYNC * 100,
    lastSync
  };
}

/** Test helper. */
function resetYoutubeCache() {
  cacheEpoch += 1;
  lastSync = null;
}

module.exports = {
  isConfigured,
  searchLatestVideos,
  syncUserNotifications,
  getStatus,
  resetYoutubeCache,
  CACHE_TTL_MS,
  MAX_GAMES_PER_SYNC
};
