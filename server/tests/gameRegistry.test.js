const test = require('node:test');
const assert = require('node:assert/strict');

const {
  gameKey,
  canonicalKey,
  slugify,
  yearFrom,
  buildGameRecord,
  mergeStats,
  mergeGameDocuments,
  collectPlayerTitles,
} = require('../utils/gameRegistry');

test('gameKey ignores case, accents and punctuation', () => {
  assert.equal(gameKey('  Pokémon:  Scarlet/Violet '), 'pokemon scarlet violet');
  assert.equal(gameKey('ELDEN-RING'), 'elden ring');
  assert.equal(gameKey('???'), '');
});

test('canonicalKey drops edition suffixes but keeps the base title', () => {
  assert.equal(canonicalKey('Hades - Game of the Year Edition'), 'hades');
  assert.equal(canonicalKey('Celeste Deluxe Edition'), 'celeste');
  // DLC-inclusive titles are different products and must stay distinct.
  assert.equal(
    canonicalKey('Elden Ring: Shadow of the Erdtree Edition'),
    'elden ring shadow of the erdtree edition',
  );
  assert.equal(canonicalKey('Hades'), 'hades');
  assert.equal(canonicalKey('Remastered'), 'remastered');
});

test('slugify is URL safe and bounded', () => {
  assert.equal(slugify('Apex Legends'), 'apex-legends');
  assert.equal(slugify('Tom Clancy’s Rainbow Six® Siege'), 'tom-clancy-s-rainbow-six-siege');
  assert.ok(slugify('x'.repeat(200)).length <= 80);
});

test('yearFrom accepts plausible years only', () => {
  assert.equal(yearFrom('2024-03-01'), 2024);
  assert.equal(yearFrom('1994'), 1994);
  assert.equal(yearFrom('1200'), null);
  assert.equal(yearFrom(''), null);
});

test('buildGameRecord derives identity and refuses empty titles', () => {
  const record = buildGameRecord({
    title: 'Baldur’s Gate 3',
    summary: 'RPG',
    genres: ['RPG', 'RPG', 'Strategy'],
    platforms: ['PC'],
    releaseDate: '2023-08-03',
    externalIds: { igdb: 119171 },
  });

  assert.equal(record.title, 'Baldur’s Gate 3');
  assert.equal(record.key, 'baldur s gate 3');
  assert.equal(record.slug, 'baldur-s-gate-3');
  assert.deepEqual(record.genres, ['RPG', 'Strategy']);
  assert.equal(record.releaseYear, 2023);
  assert.equal(record.status, 'provisional');
  assert.equal(buildGameRecord({ title: '   ' }), null);
});

test('mergeStats adds counters without going negative', () => {
  assert.deepEqual(
    mergeStats({ favoriteCount: 4, playerCount: 2 }, { favoriteCount: 3, playerCount: -5 }),
    { favoriteCount: 7, squadCount: 0, serverCount: 0, postCount: 0, playerCount: 0 },
  );
});

test('mergeGameDocuments keeps the survivor key and absorbs the duplicate aliases', () => {
  const primary = {
    title: 'Valorant',
    key: 'valorant',
    aliases: [],
    aliasKeys: [],
    screenshots: [],
    genres: ['Shooter'],
    platforms: ['PC'],
    stats: { favoriteCount: 2 },
  };
  const duplicate = {
    title: 'VALORANT',
    key: 'valorant',
    aliases: [],
    aliasKeys: [],
    screenshots: ['shot'],
    genres: ['Shooter', 'Tactical'],
    platforms: ['PC'],
    stats: { favoriteCount: 5 },
  };

  const merged = mergeGameDocuments(primary, duplicate);
  assert.equal(merged.title, 'Valorant');
  assert.ok(!merged.aliasKeys.includes('valorant'));
  assert.deepEqual(merged.genres, ['Shooter', 'Tactical']);
  assert.equal(merged.stats.favoriteCount, 7);
  assert.ok(merged.aliases.includes('VALORANT'));
});

test('collectPlayerTitles combines preferences and passport without inventing titles', () => {
  assert.deepEqual(
    collectPlayerTitles({
      preferences: { favoriteGames: ['Apex Legends'] },
      gamerPassport: { activeGames: [{ gameName: 'Hades' }, { gameName: '' }] },
    }),
    ['Apex Legends', 'Hades'],
  );
});
