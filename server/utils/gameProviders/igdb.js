/**
 * IGDB provider (optional).
 *
 * IGDB is free and explicitly permits local caching, which is what makes it a
 * good enrichment source rather than a live dependency. It authenticates with
 * Twitch application credentials: the token is cached until shortly before it
 * expires, and all requests share a small queue because the API allows four
 * requests per second.
 *
 * Without IGDB_CLIENT_ID / IGDB_CLIENT_SECRET this module reports
 * `configured: false` and every caller must fall back to FreeToGame.
 */
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const API_BASE = 'https://api.igdb.com/v4';
const MIN_INTERVAL_MS = 260; // ~4 requests/second, with headroom
const TOKEN_SAFETY_MS = 60 * 1000;

const configured = () =>
  Boolean(
    String(process.env.IGDB_CLIENT_ID || '').trim() &&
    String(process.env.IGDB_CLIENT_SECRET || '').trim(),
  );

let token = null;
let tokenExpiresAt = 0;
let lastRequestAt = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function imageUrl(imageId, size = 't_cover_big') {
  return imageId ? `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg` : null;
}

async function getAccessToken({ fetchImpl = fetch, now = Date.now } = {}) {
  if (token && now() < tokenExpiresAt - TOKEN_SAFETY_MS) return token;

  const params = new URLSearchParams({
    client_id: String(process.env.IGDB_CLIENT_ID || '').trim(),
    client_secret: String(process.env.IGDB_CLIENT_SECRET || '').trim(),
    grant_type: 'client_credentials',
  });

  const res = await fetchImpl(`${TOKEN_URL}?${params.toString()}`, { method: 'POST' });
  if (!res.ok) throw new Error(`IGDB token request failed (HTTP ${res.status})`);

  const body = await res.json();
  if (!body?.access_token) throw new Error('IGDB token response had no access_token');

  token = body.access_token;
  tokenExpiresAt = now() + Math.max(60, Number(body.expires_in) || 3600) * 1000;
  return token;
}

/** Serialised request gate: never more than ~4 requests per second. */
async function waitForSlot({ now = Date.now, sleepImpl = sleep } = {}) {
  const elapsed = now() - lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) await sleepImpl(MIN_INTERVAL_MS - elapsed);
  lastRequestAt = now();
}

async function query(endpoint, body, { fetchImpl = fetch } = {}) {
  if (!configured()) throw new Error('IGDB is not configured');
  await waitForSlot();

  const accessToken = await getAccessToken({ fetchImpl });
  const res = await fetchImpl(`${API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': String(process.env.IGDB_CLIENT_ID || '').trim(),
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'text/plain',
    },
    body,
  });

  if (res.status === 429) throw new Error('IGDB rate limit reached');
  if (!res.ok) throw new Error(`IGDB request failed (HTTP ${res.status})`);

  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

const RELEASE_YEAR = (seconds) =>
  Number.isFinite(Number(seconds)) ? new Date(Number(seconds) * 1000).getUTCFullYear() : null;

/** Map one IGDB game row to the fields the Game collection stores. */
function mapIgdbGame(raw = {}) {
  const genres = (Array.isArray(raw.genres) ? raw.genres : [])
    .map((genre) => (typeof genre === 'string' ? genre : genre?.name))
    .filter(Boolean);
  const platforms = (Array.isArray(raw.platforms) ? raw.platforms : [])
    .map((platform) => (typeof platform === 'string' ? platform : platform?.name))
    .filter(Boolean);

  return {
    id: Number(raw.id) || null,
    title: String(raw.name || '')
      .trim()
      .slice(0, 160),
    summary: String(raw.summary || '').slice(0, 4000),
    cover: {
      url: imageUrl(raw.cover?.image_id, 't_cover_big'),
      imageId: raw.cover?.image_id || null,
    },
    screenshots: (Array.isArray(raw.screenshots) ? raw.screenshots : [])
      .map((shot) => imageUrl(shot?.image_id, 't_screenshot_big'))
      .filter(Boolean)
      .slice(0, 8),
    genres,
    platforms,
    releaseYear: RELEASE_YEAR(raw.first_release_date),
    rating: Number.isFinite(raw.rating) ? Math.round(raw.rating) : null,
  };
}

const GAME_FIELDS =
  'fields name,summary,first_release_date,cover.image_id,screenshots.image_id,genres.name,platforms.name,rating;';

/** Search IGDB by title. Returns [] when unconfigured instead of throwing. */
async function searchGames(term, { limit = 8, fetchImpl = fetch } = {}) {
  if (!configured()) return [];
  const safeTerm = String(term || '')
    .replace(/["\\]/g, ' ')
    .trim()
    .slice(0, 80);
  if (!safeTerm) return [];

  const rows = await query(
    'games',
    `search "${safeTerm}"; ${GAME_FIELDS} limit ${Math.min(Math.max(Number(limit) || 8, 1), 20)};`,
    { fetchImpl },
  );
  return rows.map(mapIgdbGame).filter((game) => game.id && game.title);
}

/** Fetch one IGDB game by id (used when a row already carries an IGDB id). */
async function getGame(id, { fetchImpl = fetch } = {}) {
  if (!configured()) return null;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;

  const rows = await query('games', `where id = ${numeric}; ${GAME_FIELDS} limit 1;`, {
    fetchImpl,
  });
  return rows.length ? mapIgdbGame(rows[0]) : null;
}

function resetTokenCache() {
  token = null;
  tokenExpiresAt = 0;
  lastRequestAt = 0;
}

module.exports = {
  configured,
  getAccessToken,
  waitForSlot,
  query,
  mapIgdbGame,
  searchGames,
  getGame,
  imageUrl,
  resetTokenCache,
  MIN_INTERVAL_MS,
};
