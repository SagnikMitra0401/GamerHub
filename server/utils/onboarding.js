/**
 * Game-first onboarding helpers.
 *
 * These are deliberately pure: the controller does the database reads, then
 * uses these functions to normalise input and rank the candidates. Keeping the
 * ranking here means the edge cases (prefix matches, case, duplicate games,
 * privacy-safe projections) are testable without a database.
 */
const { sanitizeLine, tagKey } = require('./sanitize');

const PLATFORMS = ['PC', 'PlayStation', 'Xbox', 'Switch'];
const MAX_GAMES = 5;
const MAX_ONBOARDING_GAMES = 3;

/** Turn an array or comma-separated string into unique, display-cased games. */
function normalizeGames(input, { limit = MAX_GAMES, maxLength = 60 } = {}) {
  const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : [];

  const seen = new Set();
  const games = [];
  for (const raw of list) {
    const game = sanitizeLine(String(raw ?? ''), maxLength);
    const key = gameKey(game);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    games.push(game);
    if (games.length >= limit) break;
  }
  return games;
}

/** Turn an array or comma-separated string into unique allowed platforms. */
function normalizePlatforms(input) {
  const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : [];
  const seen = new Set();
  const platforms = [];
  for (const raw of list) {
    const platform = sanitizeLine(String(raw ?? ''), 20);
    if (!PLATFORMS.includes(platform) || seen.has(platform)) continue;
    seen.add(platform);
    platforms.push(platform);
  }
  return platforms;
}

/** Case- and separator-insensitive identity for a game title. */
function gameKey(value) {
  return tagKey(value);
}

/**
 * The selected game and a candidate match when their keys are equal or one is a
 * prefix of the other. Both directions are intentional: choosing "Apex" should
 * find "Apex Legends", and choosing the full title should still match a squad
 * that shortened it.
 */
function gameMatches(selected, candidate) {
  const a = gameKey(selected);
  const b = gameKey(candidate);
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/** How strongly a community belongs in a game's suggestions. */
function communityScore(community, games = []) {
  if (!community) return 0;
  let score = 0;

  const taggedGames = Array.isArray(community.games) ? community.games : [];
  for (const tagged of taggedGames) {
    if (games.some((game) => gameMatches(game, tagged))) score += 100;
  }

  if (score === 0) {
    const haystack = gameKey(`${community.name || ''} ${community.description || ''}`);
    for (const game of games) {
      const key = gameKey(game);
      if (key && haystack.includes(key)) score += 40;
    }
  }

  return score;
}

/** Only the games the viewer and the suggested player share. */
function sharedGamesFor(player, games = []) {
  if (!player || !games.length) return [];
  const source = [
    ...(Array.isArray(player.preferences?.favoriteGames) ? player.preferences.favoriteGames : []),
    ...(Array.isArray(player.gamerPassport?.activeGames)
      ? player.gamerPassport.activeGames.map((entry) => entry?.gameName)
      : []),
  ];
  return games.filter((game) => source.some((candidate) => gameMatches(game, candidate)));
}

/**
 * Projection for a suggested player. Email, full preferences, passport and
 * social graph are intentionally absent.
 */
function publicSuggestionPlayer(player, games = []) {
  return {
    id: String(player._id || player.id || ''),
    username: player.username,
    level: player.level || 1,
    presence: player.presence || null,
    sharedGames: sharedGamesFor(player, games),
  };
}

/**
 * Count tags on the supplied recent posts that match the selected games.
 * With no selected games, the most common tags are the fallback.
 */
function countMatchingTags(posts = [], games = []) {
  const counts = new Map();
  const labels = new Map();
  const gameKeys = games.map(gameKey).filter(Boolean);

  for (const post of posts) {
    for (const tag of post?.tags || []) {
      const key = tagKey(tag);
      if (!key) continue;
      if (
        gameKeys.length &&
        !gameKeys.some((game) => key === game || key.startsWith(game) || game.startsWith(key))
      ) {
        continue;
      }
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!labels.has(key)) labels.set(key, tag);
    }
  }

  return [...counts.entries()]
    .map(([key, postCount]) => ({ tag: labels.get(key), postCount }))
    .sort((a, b) => b.postCount - a.postCount || a.tag.localeCompare(b.tag))
    .slice(0, 5);
}

module.exports = {
  PLATFORMS,
  MAX_GAMES,
  MAX_ONBOARDING_GAMES,
  normalizeGames,
  normalizePlatforms,
  gameKey,
  gameMatches,
  communityScore,
  sharedGamesFor,
  publicSuggestionPlayer,
  countMatchingTags,
};
