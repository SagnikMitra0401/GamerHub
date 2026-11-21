const test = require('node:test');
const assert = require('node:assert/strict');

const { canViewStory, groupStories } = require('../utils/storyAccess');

const alice = { _id: 'a1', username: 'alice', level: 4, role: 'user' };
const bob = { _id: 'b2', username: 'bob', level: 2, role: 'user' };

const story = (overrides = {}) => ({
  _id: 's1',
  authorId: alice,
  kind: 'text',
  text: 'gg',
  background: 'aurora',
  visibility: 'followers',
  viewCount: 0,
  createdAt: new Date('2026-11-19T10:00:00Z'),
  expiresAt: new Date('2026-11-20T10:00:00Z'),
  ...overrides
});

test('a followers-only story requires an actual follow', () => {
  assert.equal(canViewStory({ story: story(), viewerId: 'b2', followingIds: ['a1'] }), true);
  assert.equal(canViewStory({ story: story(), viewerId: 'b2', followingIds: [] }), false);
});

test('public stories are open, signed in or not', () => {
  const publicStory = story({ visibility: 'public' });
  assert.equal(canViewStory({ story: publicStory, viewerId: null }), true);
  assert.equal(canViewStory({ story: publicStory, viewerId: 'b2', followingIds: [] }), true);
});

test('the author always sees their own story, followers or not', () => {
  assert.equal(canViewStory({ story: story(), viewerId: 'a1', followingIds: [] }), true);
});

test('a block beats a follow or public visibility', () => {
  // `blockedIds` are the authors this viewer has blocked; the controller
  // filters the opposite direction (author blocked the viewer) as well.
  assert.equal(canViewStory({
    story: story({ visibility: 'public' }),
    viewerId: 'b2',
    followingIds: ['a1'],
    blockedIds: ['a1']
  }), false);

  assert.equal(canViewStory({
    story: story(),
    viewerId: 'b2',
    followingIds: ['a1'],
    blockedIds: ['a1']
  }), false);
});

test('anonymous readers never see a followers-only story', () => {
  assert.equal(canViewStory({ story: story(), viewerId: null, followingIds: [] }), false);
  assert.equal(canViewStory({ story: null, viewerId: 'b2' }), false);
});

test('groupStories groups by author, oldest story first, own group leading', () => {
  const later = story({
    _id: 's2',
    createdAt: new Date('2026-11-19T11:00:00Z'),
    visibility: 'public'
  });
  const bobStory = story({
    _id: 's3',
    authorId: bob,
    createdAt: new Date('2026-11-19T12:00:00Z'),
    visibility: 'public'
  });

  const groups = groupStories({
    stories: [later, story(), bobStory],
    seenIds: ['s1'],
    viewerId: 'a1'
  });

  assert.equal(groups.length, 2);
  assert.equal(groups[0].isOwn, true);
  assert.equal(groups[0].author.username, 'alice');
  assert.deepEqual(groups[0].stories.map((item) => item._id), ['s1', 's2']);
  assert.equal(groups[0].seen, false, 's2 is still unseen');
  assert.equal(groups[1].author.username, 'bob');
  assert.equal(groups[1].seen, false);
});

test('groupStories marks a group seen only when every story has a receipt', () => {
  const groups = groupStories({
    stories: [story({ _id: 's1' }), story({ _id: 's2' })],
    seenIds: ['s1', 's2'],
    viewerId: 'b2'
  });

  assert.equal(groups[0].seen, true);
  assert.deepEqual(groups[0].stories.map((item) => item.seen), [true, true]);
});

test('groupStories only exposes presentation fields for the author', () => {
  const groups = groupStories({ stories: [story()], seenIds: [], viewerId: 'b2' });
  const author = groups[0].author;

  assert.deepEqual(Object.keys(author).sort(), ['_id', 'avatarUrl', 'level', 'role', 'username']);
  assert.equal(author.email, undefined);
});
