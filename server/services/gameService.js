/**
 * Game catalog service.
 *
 * The catalog front must render before — and even without — a provider sync,
 * so the database is the system of record and providers only fill it. Every
 * public read goes through this module: list, rails, detail, follow.
 */
const Game = require('../models/Game');
const User = require('../models/User');
const Post = require('../models/Post');
const Party = require('../models/Party');
const Community = require('../models/Community');

const freetogame = require('../utils/gameProviders/freetogame');
const igdb = require('../utils/gameProviders/igdb');
const { buildGameRecord, canonicalKey, mergeGameDocuments } = require('../utils/gameRegistry');
const { cacheWrap } = require('../utils/redisCache');
const { escapeRegex, sanitizeLine } = require('../utils/sanitize');
const { parseLimit } = require('../utils/pagination');

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 48;
const RAIL_LIMIT = 8;
const PUBLIC_STATUSES = ['published', 'provisional'];

let seedPromise = null;

const toCard = (game) => ({
  id: String(game._id),
  slug: game.slug,
  title: game.title,
  cover: game.cover?.url || null,
  // Legacy shape kept for older clients/tests: one representative genre/platform.
  thumbnail: game.cover?.url || null,
  genre: (game.genres || [])[0] || '',
  platform: (game.platforms || [])[0] || '',
  genres: game.genres || [],
  platforms: game.platforms || [],
  releaseYear: game.releaseYear || null,
  summary: (game.summary || '').slice(0, 220),
  stats: game.stats || {},
  status: game.status,
});

function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeCursor(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function cursorConstraint(sort, cursor) {
  if (!cursor || cursor.sort !== sort || !cursor.id) return {};
  const id = cursor.id;
  if (sort === 'az') {
    return { $or: [{ title: { $gt: cursor.value } }, { title: cursor.value, _id: { $gt: id } }] };
  }
  if (sort === 'new') {
    return {
      $or: [
        { releaseYear: { $lt: cursor.value } },
        { releaseYear: cursor.value, _id: { $lt: id } },
      ],
    };
  }
  return {
    $or: [
      { 'stats.favoriteCount': { $lt: cursor.value } },
      { 'stats.favoriteCount': cursor.value, _id: { $lt: id } },
    ],
  };
}

function cursorValue(sort, game) {
  if (sort === 'az') return game.title;
  if (sort === 'new') return game.releaseYear;
  return Number(game.stats?.favoriteCount || 0);
}

/**
 * Upsert provider rows. Existing rows keep their slug, counters and status:
 * a sync must never reset a player's follow count or an admin's hide decision.
 */
async function syncFreeToPlay({ limit = 240 } = {}) {
  const catalog = await freetogame.getCatalog();
  const games = (catalog.games || []).slice(0, Math.max(1, Math.min(Number(limit) || 240, 500)));

  const operations = games
    .map((raw) => {
      const record = buildGameRecord({
        title: raw.title,
        source: 'freetogame',
        status: 'published',
        summary: raw.shortDescription,
        cover: { url: raw.thumbnail, imageId: null },
        genres: [raw.genre],
        platforms: [raw.platform],
        releaseDate: raw.releaseDate,
        externalIds: { freetogame: raw.id },
      });
      if (!record) return null;

      return {
        updateOne: {
          filter: { key: record.key },
          update: {
            $set: {
              title: record.title,
              summary: record.summary,
              cover: record.cover,
              genres: record.genres,
              platforms: record.platforms,
              releaseYear: record.releaseYear,
              'externalIds.freetogame': raw.id,
              lastSyncedAt: new Date(),
            },
            $setOnInsert: {
              slug: record.slug,
              key: record.key,
              source: 'freetogame',
              status: 'published',
              aliases: [],
              aliasKeys: [],
              screenshots: [],
              stats: {},
            },
          },
          upsert: true,
        },
      };
    })
    .filter(Boolean);

  if (!operations.length) return { synced: 0, provider: 'freetogame' };

  let result;
  try {
    result = await Game.bulkWrite(/** @type {any} */ (operations), { ordered: false });
  } catch (err) {
    // A slug collision on a rare title must not fail the whole sync.
    if (err?.code !== 11000 && !Array.isArray(err?.writeErrors)) throw err;
    result = { upsertedCount: err.result?.upsertedCount || 0, modifiedCount: 0 };
  }

  return {
    synced: games.length,
    inserted: result.upsertedCount || 0,
    updated: result.modifiedCount || 0,
    provider: 'freetogame',
    fetchedAt: catalog.fetchedAt,
    stale: Boolean(catalog.stale),
  };
}

/** Seed once per process when the collection is empty; never block a request forever. */
async function ensureCatalogSeeded() {
  const existing = await Game.estimatedDocumentCount();
  if (existing > 0) return existing;

  if (!seedPromise) {
    seedPromise = syncFreeToPlay({ limit: 240 })
      .catch((err) => {
        console.error('[games] initial seed failed:', err.message);
        return { synced: 0 };
      })
      .finally(() => {
        seedPromise = null;
      });
  }
  await seedPromise;
  return Game.estimatedDocumentCount();
}

/** Enrich one row from IGDB when credentials are present. */
async function enrichGameFromIgdb(game) {
  if (!game || !igdb.configured()) return game;
  try {
    const matches = await igdb.searchGames(game.title, { limit: 5 });
    const wanted = canonicalKey(game.title);
    const match = matches.find((entry) => canonicalKey(entry.title) === wanted) || matches[0];
    if (!match) return game;

    await Game.updateOne(
      { _id: game._id },
      {
        $set: {
          summary: game.summary || match.summary || '',
          cover: match.cover?.url ? match.cover : game.cover,
          screenshots: match.screenshots?.length ? match.screenshots : game.screenshots,
          genres: match.genres?.length ? match.genres : game.genres,
          platforms: match.platforms?.length ? match.platforms : game.platforms,
          releaseYear: match.releaseYear || game.releaseYear,
          'externalIds.igdb': match.id,
          lastSyncedAt: new Date(),
        },
      },
    );
    return { ...game, ...match, externalIds: { ...game.externalIds, igdb: match.id } };
  } catch (err) {
    console.error('[games] IGDB enrichment failed:', err.message);
    return game;
  }
}

async function listGames({
  q = '',
  genre = '',
  platform = '',
  sort = 'trending',
  cursor = null,
  limit = DEFAULT_LIMIT,
} = {}) {
  await ensureCatalogSeeded();

  const safeLimit = parseLimit(limit, { fallback: DEFAULT_LIMIT, max: MAX_LIMIT });
  const safeSort = ['trending', 'new', 'az'].includes(sort) ? sort : 'trending';
  const needle = sanitizeLine(q, 60);

  const filter = { status: { $in: PUBLIC_STATUSES } };
  if (genre) filter.genres = sanitizeLine(genre, 40);
  if (platform) filter.platforms = sanitizeLine(platform, 40);
  if (needle) {
    const pattern = new RegExp(escapeRegex(needle), 'i');
    filter.$and = [{ $or: [{ title: pattern }, { aliases: pattern }] }];
  }

  const constraint = cursorConstraint(safeSort, decodeCursor(cursor));
  if (Object.keys(constraint).length) {
    filter.$and = [...(filter.$and || []), constraint];
  }

  /** @type {Record<string, 1|-1>} */
  const sortSpec =
    safeSort === 'az'
      ? { title: 1, _id: 1 }
      : safeSort === 'new'
        ? { releaseYear: -1, _id: -1 }
        : { 'stats.favoriteCount': -1, _id: -1 };

  const [rows, total, facets] = await Promise.all([
    Game.find(filter)
      .sort(sortSpec)
      .limit(safeLimit + 1)
      .lean(),
    Game.countDocuments(filter),
    catalogFacets(),
  ]);

  const hasMore = rows.length > safeLimit;
  const page = rows.slice(0, safeLimit);
  const last = page[page.length - 1];

  return {
    games: page.map(toCard),
    total,
    // Legacy field some older clients read; same value as `total`.
    catalogSize: total,
    nextCursor:
      hasMore && last
        ? encodeCursor({ sort: safeSort, value: cursorValue(safeSort, last), id: String(last._id) })
        : null,
    filters: { q: needle, genre, platform, sort: safeSort },
    facets,
    provider: providerInfo(),
  };
}

/** Facets are cheap but change only on sync, so cache them briefly. */
const catalogFacets = () =>
  cacheWrap(
    'games:facets',
    async () => {
      const [genres, platforms] = await Promise.all([
        Game.distinct('genres', { status: { $in: PUBLIC_STATUSES } }),
        Game.distinct('platforms', { status: { $in: PUBLIC_STATUSES } }),
      ]);
      return {
        genres: genres.filter(Boolean).sort(),
        platforms: platforms.filter(Boolean).sort(),
      };
    },
    300,
  );

function providerInfo() {
  return {
    primary: 'FreeToGame',
    enriched: igdb.configured(),
    attribution: igdb.configured() ? 'Game data by IGDB and FreeToGame' : 'Game data by FreeToGame',
  };
}

/**
 * Public rails. Each rail hides itself when it has nothing honest to show:
 * an empty "Trending now" is worse than no "Trending now".
 */
async function getRails(user = null) {
  await ensureCatalogSeeded();

  const base = { status: { $in: PUBLIC_STATUSES } };
  const [trending, fresh, freeToPlay] = await Promise.all([
    Game.find(base)
      .sort({ 'stats.favoriteCount': -1, 'stats.playerCount': -1, updatedAt: -1 })
      .limit(RAIL_LIMIT)
      .lean(),
    Game.find({ ...base, releaseYear: { $ne: null } })
      .sort({ releaseYear: -1, 'stats.favoriteCount': -1 })
      .limit(RAIL_LIMIT)
      .lean(),
    Game.find({ ...base, 'externalIds.freetogame': { $ne: null } })
      .sort({ 'stats.favoriteCount': -1, _id: -1 })
      .limit(RAIL_LIMIT)
      .lean(),
  ]);

  const rails = [
    { key: 'trending', label: 'Trending now', games: trending.map(toCard) },
    { key: 'new', label: 'New & notable', games: fresh.map(toCard) },
    { key: 'free', label: 'Free to play', games: freeToPlay.map(toCard) },
  ];

  if (user) {
    const titles = (user.preferences?.favoriteGames || []).map(canonicalKey).filter(Boolean);
    if (titles.length) {
      const yours = await Game.find({
        $or: [{ key: { $in: titles } }, { aliasKeys: { $in: titles } }],
        status: { $in: PUBLIC_STATUSES },
      })
        .sort({ 'stats.favoriteCount': -1 })
        .limit(RAIL_LIMIT)
        .lean();
      rails.unshift({ key: 'yours', label: 'Popular in your games', games: yours.map(toCard) });
    }
  }

  return {
    rails: rails.filter((rail) => rail.games.length > 0),
    provider: providerInfo(),
    generatedAt: new Date().toISOString(),
  };
}

const namesFor = (game) => [game.title, ...(game.aliases || [])].filter(Boolean);

/**
 * One game page. Counts are live reads so a fresh squad or someone launching
 * the game shows up immediately; the stored counters remain the cheap rail
 * signal.
 */
async function getGameDetail(slugOrId) {
  const raw = String(slugOrId || '').trim();
  if (!raw) return null;

  let game = await Game.findOne({ slug: raw.toLowerCase(), status: { $ne: 'merged' } }).lean();

  // Numeric ids keep old /games/:id links working.
  if (!game && /^\d+$/.test(raw)) {
    game = await Game.findOne({
      'externalIds.freetogame': Number(raw),
      status: { $ne: 'merged' },
    }).lean();
  }
  // ObjectId links come from the catalog cards and older bookmarks.
  if (!game && /^[a-f0-9]{24}$/i.test(raw)) {
    game = await Game.findById(raw).lean();
  }
  if (!game || game.status === 'hidden') return null;

  // A catalog row starts with only a one-line teaser and a cover. The detail
  // payload adds the description, screenshots and requirements; fetch it once
  // and persist it so the next visit is a pure database read. The catalog sync
  // always fills `summary`, so checking that alone skipped the real media.
  if (!game.detailFetchedAt && game.externalIds?.freetogame) {
    try {
      const detail = await freetogame.getGameDetail(game.externalIds.freetogame);
      if (detail) {
        const patch = {
          summary: game.summary || detail.description || detail.shortDescription || '',
          screenshots: detail.screenshots?.length ? detail.screenshots : game.screenshots,
          requirements: detail.minimumSystemRequirements || game.requirements,
          lastSyncedAt: new Date(),
          detailFetchedAt: new Date(),
        };
        await Game.updateOne({ _id: game._id }, { $set: patch });
        game = { ...game, ...patch };
      }
    } catch (err) {
      // A provider outage must not turn a known game into a 404.
      console.error('[games] detail fetch failed:', err.message);
    }
  }

  const names = namesFor(game);
  const tagCandidates = [...new Set([game.slug, ...names.map(canonicalKey).filter(Boolean)])];

  const [
    favorites,
    squads,
    servers,
    posts,
    playing,
    openSquads,
    communities,
    recentPosts,
    related,
  ] = await Promise.all([
    User.countDocuments({ 'preferences.favoriteGames': { $in: names } }),
    Party.countDocuments({
      gameTitle: { $in: names },
      state: { $in: ['recruiting', 'locked', 'active', 'completed'] },
    }),
    Community.countDocuments({ games: { $in: names } }),
    Post.countDocuments({ tags: { $in: tagCandidates }, hiddenAt: null }),
    User.countDocuments({ 'presence.activeGame': { $in: names }, 'presence.status': 'in_game' }),
    Party.find({ gameTitle: { $in: names }, state: 'recruiting', expiresAt: { $gt: new Date() } })
      .select('gameTitle activity members maxSlots requirements expiresAt leaderId')
      .populate('leaderId', 'username level presence')
      .sort({ createdAt: -1 })
      .limit(6)
      .lean(),
    Community.find({ games: { $in: names } })
      .select('name slug icon memberCount games isPrivate')
      .sort({ memberCount: -1 })
      .limit(6)
      .lean(),
    Post.find({ tags: { $in: tagCandidates }, hiddenAt: null })
      .select('title tags likeCount commentCount createdAt userId mediaUrl mediaCardUrl mediaType')
      .populate('userId', 'username level')
      .sort({ createdAt: -1 })
      .limit(4)
      .lean(),
    Game.find({
      genres: { $in: game.genres || [] },
      _id: { $ne: game._id },
      status: { $in: PUBLIC_STATUSES },
    })
      .sort({ 'stats.favoriteCount': -1, releaseYear: -1 })
      .limit(6)
      .lean(),
  ]);

  return {
    ...game,
    id: String(game._id),
    // Cards expose a URL string; keep the detail payload in the same shape so
    // consumers do not try to render Cloudinary's `{ url, imageId }` object.
    cover: game.cover?.url || null,
    stats: {
      favoriteCount: favorites,
      squadCount: squads,
      serverCount: servers,
      postCount: posts,
      playerCount: playing,
    },
    openSquads: openSquads.map((squad) => ({
      id: String(squad._id),
      gameTitle: squad.gameTitle,
      activity: squad.activity,
      maxSlots: squad.maxSlots,
      memberCount: (squad.members || []).length,
      micRequired: Boolean(squad.requirements?.micRequired),
      expiresAt: squad.expiresAt,
      leader: squad.leaderId,
    })),
    communities: communities.map((community) => ({
      id: String(community._id),
      name: community.name,
      slug: community.slug,
      icon: community.icon,
      memberCount: /** @type {any} */ (community).memberCount || 0,
      isPrivate: Boolean(community.isPrivate),
    })),
    recentPosts: recentPosts.map((post) => ({
      _id: String(post._id),
      title: post.title,
      tags: post.tags,
      likeCount: post.likeCount || 0,
      commentCount: post.commentCount || 0,
      createdAt: post.createdAt,
      author: post.userId,
      mediaUrl: post.mediaUrl,
      mediaCardUrl: post.mediaCardUrl,
      mediaType: post.mediaType,
    })),
    related: related.map(toCard),
    provider: providerInfo(),
  };
}

/** Toggle a game in the caller's favourites; both the user array and counter move. */
async function toggleFollowGame(userId, slug) {
  const game = await Game.findOne({
    slug: String(slug || '').toLowerCase(),
    status: { $ne: 'merged' },
  }).lean();
  if (!game) return null;

  const user = await User.findById(userId).select('preferences.favoriteGames').lean();
  if (!user) return null;

  const current = Array.isArray(user.preferences?.favoriteGames)
    ? user.preferences.favoriteGames
    : [];
  const wantedKey = canonicalKey(game.title);
  const following = current.some((title) => canonicalKey(title) === wantedKey);

  if (following) {
    const next = current.filter((title) => canonicalKey(title) !== wantedKey);
    await User.updateOne({ _id: userId }, { $set: { 'preferences.favoriteGames': next } });
    await Game.updateOne(
      { _id: game._id, 'stats.favoriteCount': { $gt: 0 } },
      { $inc: { 'stats.favoriteCount': -1 } },
    );
    return { following: false, game: toCard(game) };
  }

  if (current.length >= 20) {
    return { following: false, limitReached: true, game: toCard(game) };
  }

  await User.updateOne({ _id: userId }, { $addToSet: { 'preferences.favoriteGames': game.title } });
  await Game.updateOne({ _id: game._id }, { $inc: { 'stats.favoriteCount': 1 } });
  return { following: true, game: toCard(game) };
}

/** Admin: merge a duplicate into a survivor without touching player data. */
async function mergeGames(primaryId, duplicateId) {
  if (String(primaryId) === String(duplicateId)) throw new Error('Pick two different games');

  const [primary, duplicate] = await Promise.all([
    Game.findById(primaryId),
    Game.findById(duplicateId),
  ]);
  if (!primary || !duplicate) return null;

  const merged = mergeGameDocuments(primary.toObject(), duplicate.toObject());
  await Game.updateOne(
    { _id: primary._id },
    {
      $set: {
        aliases: merged.aliases,
        aliasKeys: merged.aliasKeys,
        screenshots: merged.screenshots,
        genres: merged.genres,
        platforms: merged.platforms,
        stats: merged.stats,
        summary: merged.summary,
      },
    },
  );
  await Game.updateOne(
    { _id: duplicate._id },
    { $set: { status: 'merged', mergedInto: primary._id } },
  );

  return {
    primary: toCard(await Game.findById(primary._id).lean()),
    mergedId: String(duplicate._id),
  };
}

/** Optional IGDB sync by search term; returns an empty result when unconfigured. */
async function syncIgdbSearch(term, { limit = 12 } = {}) {
  if (!igdb.configured())
    return { synced: 0, inserted: 0, updated: 0, provider: 'igdb', configured: false };

  const rows = await igdb.searchGames(term, { limit });
  const seen = new Set();
  const operations = [];

  for (const row of rows) {
    const record = buildGameRecord({
      title: row.title,
      source: 'igdb',
      status: 'published',
      summary: row.summary,
      cover: row.cover,
      screenshots: row.screenshots,
      genres: row.genres,
      platforms: row.platforms,
      releaseDate: row.releaseYear ? `${row.releaseYear}-01-01` : null,
      externalIds: { igdb: row.id },
    });
    if (!record || seen.has(record.key)) continue;
    seen.add(record.key);

    operations.push({
      updateOne: {
        filter: { key: record.key },
        update: {
          $set: {
            summary: record.summary,
            cover: record.cover,
            screenshots: record.screenshots,
            genres: record.genres,
            platforms: record.platforms,
            releaseYear: record.releaseYear,
            'externalIds.igdb': row.id,
            lastSyncedAt: new Date(),
          },
          $setOnInsert: {
            slug: record.slug,
            key: record.key,
            title: record.title,
            source: 'igdb',
            status: 'published',
            aliases: [],
            aliasKeys: [],
            stats: {},
          },
        },
        upsert: true,
      },
    });
  }

  if (!operations.length) return { synced: 0, inserted: 0, updated: 0, provider: 'igdb' };

  let result;
  try {
    result = await Game.bulkWrite(/** @type {any} */ (operations), { ordered: false });
  } catch (err) {
    if (err?.code !== 11000 && !Array.isArray(err?.writeErrors)) throw err;
    result = { upsertedCount: err.result?.upsertedCount || 0, modifiedCount: 0 };
  }

  return {
    synced: operations.length,
    inserted: result.upsertedCount || 0,
    updated: result.modifiedCount || 0,
    provider: 'igdb',
  };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  ensureCatalogSeeded,
  syncFreeToPlay,
  syncIgdbSearch,
  enrichGameFromIgdb,
  listGames,
  getRails,
  getGameDetail,
  toggleFollowGame,
  mergeGames,
  providerInfo,
  toCard,
  catalogFacets,
};
