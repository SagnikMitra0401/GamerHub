const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeGames,
  normalizePlatforms,
  gameKey,
  gameMatches,
  communityScore,
  sharedGamesFor,
  publicSuggestionPlayer,
  countMatchingTags
} = require('../utils/onboarding');

test('games are trimmed, de-duplicated case-insensitively and capped', () => {
  assert.deepEqual(
    normalizeGames(' Valorant, valorant, Apex Legends, , Elden Ring ', { limit: 3 }),
    ['Valorant', 'Apex Legends', 'Elden Ring']
  );
  assert.deepEqual(normalizeGames(['Valorant', 'VALORANT']), ['Valorant']);
  assert.deepEqual(normalizeGames(null), []);
});

test('a game longer than the display limit is clipped, not stored raw', () => {
  const [game] = normalizeGames(['x'.repeat(80)], { maxLength: 12 });
  assert.equal(game.length, 12);
});

test('only the four supported platforms survive normalization', () => {
  assert.deepEqual(
    normalizePlatforms(['PC', 'Dreamcast', 'Xbox', 'PC']),
    ['PC', 'Xbox']
  );
  assert.deepEqual(normalizePlatforms('PC, PlayStation'), ['PC', 'PlayStation']);
});

test('game matching is prefix-based in both directions but not substring-based', () => {
  assert.equal(gameKey('Apex Legends'), 'apexlegends');
  assert.equal(gameMatches('Apex', 'Apex Legends'), true);
  assert.equal(gameMatches('Apex Legends', 'Apex'), true);
  assert.equal(gameMatches('Valorant', 'VALORANT'), true);
  assert.equal(gameMatches('Legends', 'Apex Legends'), false);
  assert.equal(gameMatches('', 'Valorant'), false);
});

test('a tagged community outranks a name-only community', () => {
  const tagged = { name: 'Tactical Hub', description: '', games: ['Valorant'] };
  const named = { name: 'Valorant Elite', description: '', games: [] };
  const unrelated = { name: 'Minecraft Builders', description: '', games: [] };

  assert.equal(communityScore(tagged, ['Valorant']), 100);
  assert.equal(communityScore(named, ['Valorant']), 40);
  assert.equal(communityScore(unrelated, ['Valorant']), 0);
});

test('shared games use both preferences and the passport', () => {
  const player = {
    preferences: { favoriteGames: ['Valorant', 'Minecraft'] },
    gamerPassport: { activeGames: [{ gameName: 'Apex Legends' }] }
  };
  assert.deepEqual(
    sharedGamesFor(player, ['Valorant', 'Apex Legends', 'Elden Ring']),
    ['Valorant', 'Apex Legends']
  );
  assert.deepEqual(sharedGamesFor(player, []), []);
});

test('the suggested-player projection excludes email, preferences and passport', () => {
  const player = {
    _id: 'u1',
    username: 'nina',
    email: 'nina@example.com',
    level: 9,
    presence: { status: 'online' },
    preferences: { favoriteGames: ['Valorant'], favoriteGenres: ['FPS'] },
    gamerPassport: { activeGames: [{ gameName: 'Valorant' }] }
  };

  const projection = publicSuggestionPlayer(player, ['Valorant']);
  assert.deepEqual(Object.keys(projection).sort(), ['id', 'level', 'presence', 'sharedGames', 'username']);
  assert.equal(projection.email, undefined);
  assert.equal(projection.preferences, undefined);
  assert.equal(projection.gamerPassport, undefined);
  assert.deepEqual(projection.sharedGames, ['Valorant']);
});

test('tag counts only include matching games and cap at five', () => {
  const posts = [
    { tags: ['valorant', 'valorant', 'apex legends'] },
    { tags: ['valorant', 'minecraft'] },
    { tags: ['elden ring', 'apex legends'] },
    { tags: ['valorant'] }
  ];

  assert.deepEqual(
    countMatchingTags(posts, ['Valorant', 'Apex']),
    [
      { tag: 'valorant', postCount: 4 },
      { tag: 'apex legends', postCount: 2 }
    ]
  );

  const many = Array.from({ length: 8 }, (_, index) => ({ tags: [`tag${index}`] }));
  assert.equal(countMatchingTags(many, []).length, 5);
});
