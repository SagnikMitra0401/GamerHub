/**
 * Phase 19 end-to-end verification — relationship edges.
 *
 * Runs against a THROWAWAY database on the same cluster:
 *   node scripts/e2e-phase19.js
 *
 * These checks need the real collections, the real indexes and the real
 * migration: a unit test cannot prove that a unique pair index stops a duplicate
 * follow, that counters agree with the rows, or that a heavy account still
 * pages. The edge fixture size is read from RELATION_FIXTURE (default 20000);
 * set it to 200000 to exercise the account size the phase report names.
 */
require('dotenv').config();
const assert = require('assert/strict');
const http = require('http');
const mongoose = require('mongoose');

const E2E_DB = `gamerhub_e2e19_${Date.now().toString(36)}`;
const FIXTURE_SIZE = Number(process.env.RELATION_FIXTURE || 20000);

function tempMongoUri() {
  const url = new URL(process.env.MONGO_URI);
  url.pathname = `/${E2E_DB}`;
  return url.toString();
}

process.env.MONGO_URI = tempMongoUri();
process.env.NODE_ENV = 'test';
process.env.CLIENT_URL = 'http://localhost:3000';
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.DISABLE_RETENTION_WORKER = '1';
process.env.RELATION_EDGES = '1';

const connectDB = require('../server/config/db');
const app = require('../server/app');
const { initSocket } = require('../server/config/socket');
const { closeDomainConnections } = require('../server/config/connections');
const User = require('../server/models/User');
const Follow = require('../server/models/Follow');
const SavedPost = require('../server/models/SavedPost');
const UserBlock = require('../server/models/UserBlock');
const UserMute = require('../server/models/UserMute');
const Post = require('../server/models/Post');
const relations = require('../server/utils/relations');
const relationEdgesMigration = require('../migrations/auth/20261125090000-relation-edges');

const { api, check, registerUser, report, setBase } = require('./lib/e2e-harness');

/** A real (unpopulated) account, without the registration flow. */
async function makeUser(username) {
  return User.create({
    username,
    email: `${username}@example.com`,
    passwordHash: 'not-a-real-hash',
  });
}

/** Force reads onto one side of the flag for a block of checks. */
function useEdges(enabled) {
  process.env.RELATION_EDGES = enabled ? '1' : '0';
}

/** Seed legacy arrays directly, then prove the migration and its checks. */
async function migrationScenarios() {
  useEdges(false);
  const dave = await makeUser('rel19dave');
  const erin = await makeUser('rel19erin');
  const frank = await makeUser('rel19frank');
  const post = await Post.create({ userId: erin._id, title: 'legacy', content: 'x' });

  // Counters are unset on purpose: that is what an account the backfill has
  // not reached looks like.
  await User.updateOne(
    { _id: dave._id },
    {
      $set: {
        following: [erin._id],
        savedPosts: [post._id],
        blockedUsers: [frank._id],
        mutedUsers: [frank._id],
      },
      $unset: { followerCount: '', followingCount: '', savedCount: '' },
    },
  );
  await User.updateOne(
    { _id: erin._id },
    { $set: { followers: [dave._id] }, $unset: { followerCount: '', savedCount: '' } },
  );

  // Before the migration runs, no counter exists. A reader must then report the
  // array length, not zero.
  const pendingBackfill = await User.findById(dave._id).lean();
  const pendingCounts = await relations.countsFor(pendingBackfill);
  check('an account the backfill has not reached reports its array counts', () => {
    assert.equal(pendingBackfill.followingCount, undefined);
    assert.deepEqual(pendingCounts, { followerCount: 0, followingCount: 1, savedCount: 1 });
  });

  const pendingProfile = await api('/api/users/rel19erin');
  check('a profile served before the backfill does not show a false zero', () => {
    assert.equal(pendingProfile.status, 200, JSON.stringify(pendingProfile.data));
    assert.equal(pendingProfile.data.followerCount, 1);
    assert.equal(pendingProfile.data.followingCount, 0);
  });

  const db = mongoose.connection.db;
  assert.ok(db, 'no database handle');

  await relationEdgesMigration.up(db);
  const edges = await Promise.all([
    Follow.countDocuments(),
    SavedPost.countDocuments(),
    UserBlock.countDocuments(),
    UserMute.countDocuments(),
  ]);
  check('the migration backfills every array into an edge row', () => {
    assert.deepEqual(edges, [1, 1, 1, 1]);
  });

  const counters = await User.findById(dave._id)
    .select('followingCount followerCount savedCount')
    .lean();
  check('the migration writes the counters', () => {
    assert.equal(counters.followingCount, 1);
    assert.equal(counters.followerCount, 0);
    assert.equal(counters.savedCount, 1);
  });

  await relationEdgesMigration.up(db);
  const afterSecondRun = await Promise.all([Follow.countDocuments(), SavedPost.countDocuments()]);
  check('re-running the migration changes nothing', () => {
    assert.deepEqual(afterSecondRun, [1, 1]);
  });

  // Every index declared in a model must exist in the live collection, with
  // the same uniqueness. A missing index is a slow query, a changed one is a
  // duplicate edge.
  const indexPairs = [
    [Follow, 'follows'],
    [SavedPost, 'savedposts'],
    [UserBlock, 'userblocks'],
    [UserMute, 'usermutes'],
  ];
  const indexProblems = [];
  for (const [Model, collection] of indexPairs) {
    const live = await db.collection(collection).indexes();
    for (const [keys, options] of Model.schema.indexes()) {
      const found = live.find((index) => index.name === options.name);
      if (!found) {
        indexProblems.push(`${collection}:${options.name} missing`);
        continue;
      }
      if (Boolean(found.unique) !== Boolean(options.unique)) {
        indexProblems.push(`${collection}:${options.name} unique=${Boolean(found.unique)}`);
      }
      if (JSON.stringify(found.key) !== JSON.stringify(keys)) {
        indexProblems.push(`${collection}:${options.name} keys differ`);
      }
    }
  }
  check('every declared edge index exists with the declared options', () => {
    assert.deepEqual(indexProblems, []);
  });

  useEdges(true);
  const readBack = await relations.followedIds(dave._id);
  check('flag-on reads see backfilled edges', () =>
    assert.deepEqual(readBack.map(String), [String(erin._id)]),
  );

  // Down leaves the arrays authoritative again and drops the derived rows.
  await relationEdgesMigration.down(db);
  const afterDown = await Promise.all([
    Follow.exists({}),
    SavedPost.exists({}),
    User.findById(dave._id).select('followingCount following').lean(),
  ]);
  check('down removes the derived data and keeps the arrays', () => {
    assert.equal(afterDown[0], null);
    assert.equal(afterDown[1], null);
    assert.equal(afterDown[2].followingCount, undefined);
    assert.deepEqual(afterDown[2].following.map(String), [String(erin._id)]);
  });

  await relationEdgesMigration.up(db);
  const restored = await Follow.countDocuments();
  check('up after down restores the same rows', () => assert.equal(restored, 1));
}

async function serviceScenarios() {
  const alice = await makeUser('rel19alice');
  const bob = await makeUser('rel19bob');
  const carol = await makeUser('rel19carol');

  useEdges(true);

  // ── Follow ───────────────────────────────────────────────────────────────
  const first = await relations.follow({ followerId: alice._id, followingId: bob._id });
  check('a new follow creates one edge', () => assert.equal(first.created, true));

  const again = await relations.follow({ followerId: alice._id, followingId: bob._id });
  const pairRows = await Follow.countDocuments({ follower: alice._id, following: bob._id });
  check('following twice does not create a second edge', () => {
    assert.equal(again.created, false);
    assert.equal(pairRows, 1);
  });

  const afterFollow = await User.findById(alice._id).select('followingCount').lean();
  const followed = await User.findById(bob._id).select('followerCount followers').lean();
  check('counters and the legacy arrays follow the edge', () => {
    assert.equal(afterFollow.followingCount, 1);
    assert.equal(followed.followerCount, 1);
    assert.equal(followed.followers.map(String).includes(String(alice._id)), true);
  });

  const saved = await relations.savePost({
    userId: alice._id,
    postId: new mongoose.Types.ObjectId(),
  });
  check('a bookmark edge is written once', () => assert.equal(saved.created, true));

  // ── Block ────────────────────────────────────────────────────────────────
  await relations.follow({ followerId: bob._id, followingId: alice._id });
  const block = await relations.block({ blockerId: alice._id, blockedId: bob._id });
  const [followsAfterBlock, countersAfterBlock] = await Promise.all([
    Follow.countDocuments({ follower: { $in: [alice._id, bob._id] } }),
    User.find({ _id: { $in: [alice._id, bob._id] } })
      .select('followingCount followerCount following followers')
      .lean(),
  ]);
  check('blocking drops follow edges both ways and their counters', () => {
    assert.equal(block.created, true);
    assert.equal(followsAfterBlock, 0);
    for (const account of countersAfterBlock) {
      assert.equal(account.followingCount, 0);
      assert.equal(account.followerCount, 0);
      assert.deepEqual(account.following.map(String), []);
      assert.deepEqual(account.followers.map(String), []);
    }
  });

  const [pairBothWays, outgoing, incoming, hidden] = await Promise.all([
    relations.isBlockedPair(alice._id, bob._id),
    relations.blockedIds(alice._id),
    relations.blockerIds(bob._id),
    relations.hiddenPairIds(bob._id),
  ]);
  check('the block is visible from both directions', () => {
    assert.equal(pairBothWays, true);
    assert.deepEqual(outgoing.sort(), [String(bob._id)]);
    assert.deepEqual(incoming.sort(), [String(alice._id)]);
    assert.deepEqual(hidden.sort(), [String(alice._id)]);
  });

  await relations.unblock({ blockerId: alice._id, blockedId: bob._id });
  const [blockRows, followRows, stillBlocked] = await Promise.all([
    UserBlock.countDocuments({ blocker: alice._id }),
    Follow.countDocuments({ follower: { $in: [alice._id, bob._id] } }),
    relations.isBlockedPair(alice._id, bob._id),
  ]);
  check('unblocking removes the row and does not restore follows', () => {
    assert.equal(blockRows, 0);
    assert.equal(followRows, 0);
    assert.equal(stillBlocked, false);
  });

  // ── Mute ─────────────────────────────────────────────────────────────────
  await relations.mute({ muterId: alice._id, mutedId: carol._id });
  await relations.mute({ muterId: alice._id, mutedId: carol._id });
  const [muteRows, muted] = await Promise.all([
    UserMute.countDocuments({ muter: alice._id }),
    relations.mutedIds(alice._id),
  ]);
  check('mute is idempotent and readable', () => {
    assert.equal(muteRows, 1);
    assert.deepEqual(muted.sort(), [String(carol._id)]);
  });

  await relations.unmute({ muterId: alice._id, mutedId: carol._id });
  const [mutesLeft, mutedAfter] = await Promise.all([
    UserMute.countDocuments({ muter: alice._id }),
    relations.mutedIds(alice._id),
  ]);
  check('unmute removes the edge', () => {
    assert.equal(mutesLeft, 0);
    assert.deepEqual(mutedAfter, []);
  });

  // ── Pagination ───────────────────────────────────────────────────────────
  const fans = [];
  for (let index = 0; index < 5; index += 1) {
    const fan = await makeUser(`rel19fan${index}`);
    fans.push(fan);
    await relations.follow({ followerId: fan._id, followingId: bob._id });
  }
  const [head, tail] = await Promise.all([
    relations.followersPage(bob._id, { skip: 0, limit: 2 }),
    relations.followersPage(bob._id, { skip: 4, limit: 2 }),
  ]);
  check('followers paginate newest first by edge date', () => {
    assert.equal(head.total, 5);
    assert.equal(head.userIds.length, 2);
    assert.equal(head.userIds[0], String(fans[4]._id));
    assert.equal(tail.userIds.length, 1);
    assert.equal(tail.userIds[0], String(fans[0]._id));
  });

  const subset = await relations.followedAmong(alice._id, [bob._id, carol._id]);
  check('followedAmong reads only the candidate pool', () => {
    assert.deepEqual(subset, []);
  });

  // ── Flag-off equivalence ─────────────────────────────────────────────────
  useEdges(false);
  const [legacyFollowers, legacySaved, legacyBlocked] = await Promise.all([
    relations.followerIds(bob._id),
    relations.savedPostIds(alice._id),
    relations.blockedIds(alice._id),
  ]);
  useEdges(true);
  const edgeFollowers = await relations.followerIds(bob._id);

  check('the flag-off arrays answer the same questions', () => {
    assert.deepEqual(legacyFollowers.map(String).sort(), fans.map((fan) => String(fan._id)).sort());
    assert.equal(legacySaved.length, 1);
    assert.deepEqual(legacyBlocked, []);
  });
  check('both stores agree after the same writes', () => {
    assert.deepEqual(edgeFollowers.map(String).sort(), legacyFollowers.map(String).sort());
  });

  // ── Deleted post ─────────────────────────────────────────────────────────
  const doomed = await Post.create({ userId: carol._id, title: 'doomed', content: 'x' });
  await relations.savePost({ userId: carol._id, postId: doomed._id });
  const removed = await relations.removeSavedForPost(doomed._id);
  const [savesLeft, owner] = await Promise.all([
    SavedPost.countDocuments({ post: doomed._id }),
    User.findById(carol._id).select('savedCount savedPosts').lean(),
  ]);
  check('deleting a post clears its bookmarks and the saved counter', () => {
    assert.equal(removed.users, 1);
    assert.equal(savesLeft, 0);
    assert.equal(owner.savedCount, 0);
    assert.deepEqual(owner.savedPosts.map(String), []);
  });

  // ── Erasure ──────────────────────────────────────────────────────────────
  await relations.follow({ followerId: carol._id, followingId: bob._id });
  await relations.block({ blockerId: carol._id, blockedId: alice._id });
  await relations.eraseRelations(carol._id);
  const [edgesForCarol, blocksForCarol, bobEdges, bobAfter] = await Promise.all([
    Follow.countDocuments({ $or: [{ follower: carol._id }, { following: carol._id }] }),
    UserBlock.countDocuments({ $or: [{ blocker: carol._id }, { blocked: carol._id }] }),
    Follow.countDocuments({ following: bob._id }),
    User.findById(bob._id).select('followerCount').lean(),
  ]);
  check('erasing an account removes every edge it appears in', () => {
    assert.equal(edgesForCarol, 0);
    assert.equal(blocksForCarol, 0);
    assert.equal(bobAfter.followerCount, bobEdges);
  });
}

/**
 * A heavy account: many edges on one side, then a page read and a write.
 * This is the case the arrays could not serve without loading the whole list.
 */
async function scaleScenarios() {
  useEdges(true);
  const star = await makeUser('rel19star');
  const started = Date.now();

  // Batched insertMany: a reused bulk handle cannot be executed twice.
  for (let offset = 0; offset < FIXTURE_SIZE; offset += 10000) {
    const size = Math.min(10000, FIXTURE_SIZE - offset);
    const docs = Array.from({ length: size }, (_, index) => ({
      follower: new mongoose.Types.ObjectId(),
      following: star._id,
      createdAt: new Date(Date.now() - (offset + index) * 1000),
    }));
    await Follow.insertMany(docs, { ordered: false });
  }

  const inserted = await Follow.countDocuments({ following: star._id });
  check(`a fixture of ${FIXTURE_SIZE} follow edges is stored`, () =>
    assert.equal(inserted, FIXTURE_SIZE),
  );

  const pageStart = Date.now();
  const page = await relations.followersPage(star._id, { skip: 0, limit: 20 });
  const pageMs = Date.now() - pageStart;
  check('one page of a heavy follower list is readable without loading it', () => {
    assert.equal(page.userIds.length, 20);
    assert.equal(page.total, FIXTURE_SIZE);
  });

  const newcomer = await makeUser('rel19newcomer');
  const writeStart = Date.now();
  await relations.follow({ followerId: newcomer._id, followingId: star._id });
  const updated = await User.findById(star._id).select('followerCount').lean();
  const writeMs = Date.now() - writeStart;

  check('a heavy account accepts a new follow and reports the exact count', () => {
    assert.equal(updated.followerCount, FIXTURE_SIZE + 1);
  });

  console.log(
    `  · fixture ${FIXTURE_SIZE}: built ${Date.now() - started} ms, page ${pageMs} ms, follow ${writeMs} ms`,
  );
}

/**
 * The HTTP surface: counts instead of arrays, a capped follower page, and the
 * block/mute/save/following-feed paths reading their collections.
 */
async function routeScenarios() {
  useEdges(true);
  const alice = await registerUser('rel19routealice', { probeId: true });
  const bob = await registerUser('rel19routebob', { probeId: true });
  const bobId = new mongoose.Types.ObjectId(bob.id);

  const follow = await api(`/api/users/${bob.username}/follow`, {
    method: 'POST',
    cookie: alice.cookie,
  });
  check('the follow endpoint reports the new count', () => {
    assert.equal(follow.status, 200, JSON.stringify(follow.data));
    assert.equal(follow.data.following, true);
    assert.equal(follow.data.followerCount, 1);
  });

  const profile = await api(`/api/users/${bob.username}`, { cookie: alice.cookie });
  check('a profile carries counts and flags, not follower arrays', () => {
    assert.equal(profile.status, 200, JSON.stringify(profile.data));
    assert.equal(profile.data.followerCount, 1);
    assert.equal(profile.data.followers, undefined);
    assert.equal(profile.data.following, undefined);
    assert.equal(profile.data.isFollowing, true);
    assert.equal(profile.data.viewerHasBlocked, false);
  });

  const me = await api('/api/auth/me', { cookie: alice.cookie });
  check('the session response no longer carries relationship arrays', () => {
    for (const field of ['following', 'followers', 'savedPosts', 'blockedUsers', 'mutedUsers']) {
      assert.equal(me.data.user[field], undefined, field);
    }
  });

  const bulk = await User.insertMany(
    Array.from({ length: 55 }, (_, index) => ({
      username: `rel19bulk${index}`,
      email: `rel19bulk${index}@example.com`,
      passwordHash: 'not-a-real-hash',
    })),
  );
  await Follow.insertMany(
    bulk.map((user) => ({ follower: user._id, following: bobId, createdAt: new Date() })),
  );

  const capped = await api(`/api/users/${bob.username}/followers?limit=500`, {
    cookie: alice.cookie,
  });
  check('the follower list pages with a hard cap of 50', () => {
    assert.equal(capped.status, 200, JSON.stringify(capped.data));
    assert.equal(capped.data.items.length, 50);
    assert.equal(capped.data.total, 56);
    assert.equal(capped.data.hasMore, true);
    assert.equal(typeof capped.data.nextCursor, 'string');
  });

  const nextPage = await api(
    `/api/users/${bob.username}/followers?limit=50&cursor=${encodeURIComponent(capped.data.nextCursor)}`,
    { cookie: alice.cookie },
  );
  check('the cursor continues the page without repeating a row', () => {
    assert.equal(nextPage.status, 200, JSON.stringify(nextPage.data));
    assert.equal(nextPage.data.items.length, 6);
    assert.equal(nextPage.data.hasMore, false);
    assert.equal(nextPage.data.nextCursor, null);
    const firstPageIds = new Set(capped.data.items.map((entry) => entry._id));
    assert.equal(
      nextPage.data.items.some((entry) => firstPageIds.has(entry._id)),
      false,
    );
  });

  const following = await api(`/api/users/${alice.username}/following`, {
    cookie: alice.cookie,
  });
  check('the following list reads its own edge direction', () => {
    assert.equal(following.data.items.length, 1);
    assert.equal(following.data.items[0].username, bob.username);
  });

  const post = await api('/api/posts', {
    method: 'POST',
    cookie: bob.cookie,
    body: { title: 'Relation route probe', content: 'edge route check', tags: ['valorant'] },
  });
  check('the probe post is created', () =>
    assert.equal(post.status, 201, JSON.stringify(post.data)),
  );

  const save = await api(`/api/users/saved/${post.data._id}`, {
    method: 'POST',
    cookie: alice.cookie,
  });
  const savedIds = await api('/api/users/me/saved-ids', { cookie: alice.cookie });
  const savedList = await api('/api/users/me/saved', { cookie: alice.cookie });
  check('a bookmark reaches the saved ids and the saved list', () => {
    assert.equal(save.status, 200, JSON.stringify(save.data));
    assert.equal(save.data.saved, true);
    assert.deepEqual(savedIds.data.savedPostIds, [String(post.data._id)]);
    assert.equal(savedList.data.length, 1);
  });

  const feed = await api('/api/posts?feed=following', { cookie: alice.cookie });
  check('the following feed returns a followed author', () => {
    assert.equal(feed.status, 200, JSON.stringify(feed.data));
    assert.ok(feed.data.some((entry) => String(entry._id) === String(post.data._id)));
  });

  const block = await api(`/api/account/block/${bob.id}`, {
    method: 'POST',
    cookie: alice.cookie,
  });
  const blockedProfile = await api(`/api/users/${bob.username}`, { cookie: alice.cookie });
  const blockedList = await api('/api/account/blocked', { cookie: alice.cookie });
  const feedAfterBlock = await api('/api/posts?feed=following', { cookie: alice.cookie });
  check('a block hides the profile and the feed and drops the follow', () => {
    assert.equal(block.status, 200, JSON.stringify(block.data));
    assert.equal(blockedProfile.status, 404);
    assert.deepEqual(
      blockedList.data.items.map((entry) => entry._id),
      [bob.id],
    );
    assert.equal(
      feedAfterBlock.data.some((entry) => String(entry._id) === String(post.data._id)),
      false,
    );
  });

  await api(`/api/account/block/${bob.id}`, { method: 'DELETE', cookie: alice.cookie });
  const mute = await api(`/api/users/${bob.id}/mute`, {
    method: 'POST',
    cookie: alice.cookie,
  });
  const muted = await api('/api/users/me/muted', { cookie: alice.cookie });
  check('a mute is readable through its own collection', () => {
    assert.equal(mute.status, 200, JSON.stringify(mute.data));
    assert.equal(mute.data.muted, true);
    assert.deepEqual(muted.data.mutedUsers, [bob.id]);
  });

  // ── A removal made before the backfill ──────────────────────────────────
  // The pair exists only in the arrays. Unfollowing must clear them, or the
  // follow survives while the endpoint reports success.
  useEdges(false);
  const legacyA = await makeUser('rel19legacya');
  const legacyB = await makeUser('rel19legacyb');
  const unset = { followerCount: '', followingCount: '', savedCount: '' };
  await User.updateOne({ _id: legacyA._id }, { $set: { following: [legacyB._id] }, $unset: unset });
  await User.updateOne({ _id: legacyB._id }, { $set: { followers: [legacyA._id] }, $unset: unset });

  const beforeRemoval = await api('/api/users/rel19legacyb');
  await relations.unfollow({ followerId: legacyA._id, followingId: legacyB._id });
  const [removedPair, profileAfterRemoval] = await Promise.all([
    User.find({ _id: { $in: [legacyA._id, legacyB._id] } })
      .select('following followers')
      .lean(),
    api('/api/users/rel19legacyb'),
  ]);
  check('an unfollow before the backfill clears the arrays and the count', () => {
    assert.equal(beforeRemoval.data.followerCount, 1);
    assert.deepEqual(removedPair[0].following.map(String), []);
    assert.deepEqual(removedPair[1].followers.map(String), []);
    assert.equal(profileAfterRemoval.data.followerCount, 0);
  });
  useEdges(true);
}

async function run() {
  await connectDB();
  console.log(`Using throwaway database: ${E2E_DB}`);

  const server = http.createServer(app);
  initSocket(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  setBase(`http://127.0.0.1:${server.address().port}`);

  try {
    await migrationScenarios();
    await serviceScenarios();
    await routeScenarios();
    await scaleScenarios();
  } finally {
    await mongoose.connection.dropDatabase().catch(() => {});
    await closeDomainConnections();
    await mongoose.disconnect();
    server.close();
  }

  const failed = report();
  if (failed.length) process.exit(1);
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
