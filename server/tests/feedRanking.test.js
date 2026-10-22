const test = require('node:test');
const assert = require('node:assert/strict');

const { rankPostsForUser, MAX_ENGAGEMENT_BONUS } = require('../utils/feedRanking');

const NOW = Date.parse('2026-10-22T12:00:00.000Z');

const post = ({ id, tags = [], likes = 0, comments = 0, hours = 0 }) => ({
  _id: id,
  title: id,
  tags,
  likes: Array.from({ length: likes }, (_, i) => `liker-${i}`),
  commentCount: comments,
  createdAt: new Date(NOW - hours * 3_600_000).toISOString()
});

test('a favourite game outranks a newer unrelated post', () => {
  const ranked = rankPostsForUser(
    [post({ id: 'fresh', tags: ['news'], hours: 1 }), post({ id: 'match', tags: ['valorant'], hours: 20 })],
    { favoriteGames: ['Valorant'] },
    { now: NOW }
  );

  assert.equal(ranked[0]._id, 'match');
  assert.deepEqual(ranked[0].matchedTags, ['valorant']);
  assert.equal(ranked[0].rankScore > ranked[1].rankScore, true);
});

test('genres and followed channels are matched case-insensitively', () => {
  const ranked = rankPostsForUser(
    [post({ id: 'genre', tags: ['Shooter'] }), post({ id: 'channel', tags: ['FPS'] })],
    { favoriteGenres: ['shooter'], favoriteChannels: ['fps'] },
    { now: NOW }
  );

  // Genre (50) beats channel (30).
  assert.equal(ranked[0]._id, 'genre');
  assert.equal(ranked[1]._id, 'channel');
});

test('with no preferences, engagement then recency decides', () => {
  const ranked = rankPostsForUser(
    [
      post({ id: 'quiet', hours: 1 }),
      post({ id: 'popular', hours: 5, likes: 10, comments: 4 }),
      post({ id: 'mid', hours: 2, likes: 2 })
    ],
    {},
    { now: NOW }
  );

  assert.equal(ranked[0]._id, 'popular');
  assert.equal(ranked[1]._id, 'mid');
  assert.equal(ranked[2]._id, 'quiet');
});

test('engagement bonus is capped so old viral posts cannot dominate forever', () => {
  const ranked = rankPostsForUser([post({ id: 'viral', likes: 500, comments: 200 })], {}, { now: NOW });
  assert.equal(ranked[0].rankScore, MAX_ENGAGEMENT_BONUS);
});

test('age applies a penalty when scores are otherwise equal', () => {
  const ranked = rankPostsForUser(
    [post({ id: 'old', tags: ['valorant'], hours: 10 }), post({ id: 'new', tags: ['valorant'], hours: 2 })],
    { favoriteGames: ['valorant'] },
    { now: NOW }
  );

  assert.equal(ranked[0]._id, 'new');
  assert.equal(ranked[1].rankScore < ranked[0].rankScore, true);
});

test('missing or empty input is handled', () => {
  assert.deepEqual(rankPostsForUser(null, { favoriteGames: ['a'] }), []);
  assert.deepEqual(rankPostsForUser([], {}), []);
});

test('ranks are deterministic for equal posts', () => {
  const posts = [post({ id: 'a', hours: 3 }), post({ id: 'b', hours: 3 })];
  const first = rankPostsForUser(posts, {}, { now: NOW }).map((p) => p._id);
  const second = rankPostsForUser(posts, {}, { now: NOW }).map((p) => p._id);
  assert.deepEqual(first, second);
});
