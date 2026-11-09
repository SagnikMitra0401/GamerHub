const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeTags, extractHashtags, tagKey } = require('../utils/sanitize');

test('inline hashtags are extracted, lowercased and stripped of the #', () => {
  assert.deepEqual(
    extractHashtags('Playing #EldenRing tonight with #co_op and #1v1'),
    ['eldenring', 'co op', '1v1']
  );
});

test('hashtags inside URLs are not treated as tags', () => {
  assert.deepEqual(extractHashtags('Source: https://example.com/page#section #gaming'), ['gaming']);
});

test('hashtags need letters, numbers or underscores and stop at punctuation', () => {
  assert.deepEqual(extractHashtags('Hello #world! Is #this, #valid?'), ['world', 'this', 'valid']);
  assert.deepEqual(extractHashtags('A bare # is not a tag'), []);
});

test('normalizeTags merges explicit tags with inline hashtags and dedupes loosely', () => {
  const tags = normalizeTags([
    'Battle Royale',
    '#battleroyale',
    'elden ring',
    '#Elden-Ring',
    'FPS'
  ]);

  assert.deepEqual(tags, ['battle royale', 'elden ring', 'fps']);
});

test('normalizeTags caps a post at ten tags', () => {
  const tags = normalizeTags(Array.from({ length: 20 }, (_, i) => `tag${i}`));
  assert.equal(tags.length, 10);
});

test('tagKey ignores separators, case and a leading #', () => {
  assert.equal(tagKey('#Elden-Ring'), tagKey('elden ring'));
  assert.equal(tagKey('Battle Royale'), tagKey('battleroyale'));
});
