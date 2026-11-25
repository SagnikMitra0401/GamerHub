/**
 * Relationship edges: follows, bookmarks, blocks and personal mutes.
 *
 * Each relationship used to be an ObjectId array on the user document, which
 * every signed-in request loaded and which caps a heavy account at 16 MB. They
 * now live in one collection per relationship (see models/Follow.js and
 * friends), with denormalised counters on the user.
 *
 * Rollout is staged:
 *   - every write below updates the edge row, the legacy array and the counter
 *   - reads use the edge collections only when RELATION_EDGES=1
 *
 * Keeping the arrays current for one release means a rollback is a flag change
 * plus the migration's `down`, with no data recovery. Remove the array writes in
 * the release after the flag has been on everywhere.
 *
 * The flag is read per call, not cached at require time, so a test suite can
 * exercise both sides in one process.
 */
const mongoose = require('mongoose');

const Follow = require('../models/Follow');
const SavedPost = require('../models/SavedPost');
const UserBlock = require('../models/UserBlock');
const UserMute = require('../models/UserMute');
const User = require('../models/User');

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

/** True when reads should come from the edge collections. */
function edgesEnabled() {
  return TRUE_VALUES.has(
    String(process.env.RELATION_EDGES || '')
      .toLowerCase()
      .trim(),
  );
}

/** ObjectId or document to its string id, without throwing on null. */
function idOf(value) {
  if (!value) return '';
  if (typeof value === 'object' && '_id' in value) return String(value._id);
  return String(value);
}

/** Unique, non-empty string ids in input order. */
function uniqueIds(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const id = idOf(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** The legacy array from the user document, used while the flag is off. */
async function legacyArray(userId, field) {
  const user = await User.findById(userId).select(field).lean();
  return (user?.[field] || []).filter(Boolean);
}

/**
 * Recompute the three public counters from the edge collections.
 *
 * Counters are recomputed rather than incremented so a retried request, a
 * duplicate key race or an interrupted write cannot leave a permanent drift.
 * The cost is one indexed aggregation per counter for the affected accounts.
 *
 * A counter that is still `undefined` is left alone: the backfill has not
 * reached that account, and the edge rows there are only the writes made since
 * the deploy, so writing that number would replace the array fallback with a
 * partial count. The migration is the only writer that fills these in.
 * @param {Array<string|import('mongoose').Types.ObjectId>} userIds
 */
async function recount(userIds) {
  const ids = uniqueIds(userIds).map((id) => new User.base.Types.ObjectId(id));
  if (!ids.length) return;

  const [following, followers, saved, current] = await Promise.all([
    Follow.aggregate([
      { $match: { follower: { $in: ids } } },
      { $group: { _id: '$follower', count: { $sum: 1 } } },
    ]),
    Follow.aggregate([
      { $match: { following: { $in: ids } } },
      { $group: { _id: '$following', count: { $sum: 1 } } },
    ]),
    SavedPost.aggregate([
      { $match: { user: { $in: ids } } },
      { $group: { _id: '$user', count: { $sum: 1 } } },
    ]),
    User.find({ _id: { $in: ids } })
      .select('followerCount followingCount savedCount')
      .lean(),
  ]);

  const byId = (rows) => new Map(rows.map((row) => [String(row._id), row.count]));
  const computed = {
    followingCount: byId(following),
    followerCount: byId(followers),
    savedCount: byId(saved),
  };
  const known = new Map(current.map((doc) => [String(doc._id), doc]));

  const operations = [];
  for (const id of ids) {
    const doc = known.get(String(id));
    const update = {};
    for (const [field, counts] of Object.entries(computed)) {
      if (doc?.[field] === undefined || doc?.[field] === null) continue;
      update[field] = counts.get(String(id)) || 0;
    }
    if (Object.keys(update).length) {
      operations.push({ updateOne: { filter: { _id: id }, update: { $set: update } } });
    }
  }

  if (operations.length) await User.bulkWrite(operations, { ordered: false });
}

// ── Reads ─────────────────────────────────────────────────────────────────

/** Counter field to the legacy array that still mirrors it. */
const COUNTER_ARRAYS = {
  followerCount: 'followers',
  followingCount: 'following',
  savedCount: 'savedPosts',
};

/** Length of an array field, treating a missing value as empty. */
function sizeOf(value) {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * The three public counters for a user document or id.
 *
 * A counter is `undefined` until the backfill has written it, so a plain
 * `?? 0` would report an established account as new during the rollout. The
 * arrays are still updated on every write for the rollback release, so their
 * length is the correct number for any account the backfill has not reached.
 * Counters are resolved one by one: an account with some counters written keeps
 * them and only the missing ones read the array.
 * @param {object|string|import('mongoose').Types.ObjectId} userOrId
 */
async function countsFor(userOrId) {
  const doc =
    userOrId && typeof userOrId === 'object' ? userOrId : await User.findById(userOrId).lean();
  if (!doc) return { followerCount: 0, followingCount: 0, savedCount: 0 };

  const missing = Object.keys(COUNTER_ARRAYS).filter(
    (field) => doc[field] === undefined || doc[field] === null,
  );

  // Read the arrays from the database rather than from the caller's document:
  // the profile projection drops the follow arrays, and a document loaded
  // before a write would answer with stale lengths.
  const arrays = missing.length
    ? await User.findById(doc._id)
        .select(missing.map((field) => COUNTER_ARRAYS[field]).join(' '))
        .lean()
    : null;

  const counts = {};
  for (const [field, array] of Object.entries(COUNTER_ARRAYS)) {
    counts[field] =
      doc[field] === undefined || doc[field] === null ? sizeOf(arrays?.[array]) : doc[field];
  }
  return counts;
}

/** Does `followerId` follow `followingId`? */
async function isFollowing(followerId, followingId) {
  const follower = idOf(followerId);
  const following = idOf(followingId);
  if (!follower || !following) return false;
  if (edgesEnabled()) {
    return Boolean(await Follow.exists({ follower, following }));
  }
  const ids = await legacyArray(follower, 'following');
  return ids.some((entry) => idOf(entry) === following);
}

/** Everyone `userId` follows. Bounded by that account's own follow count. */
async function followedIds(userId) {
  const id = idOf(userId);
  if (!id) return [];
  if (!edgesEnabled()) return legacyArray(id, 'following');
  return Follow.find({ follower: id }).distinct('following');
}

/** Everyone who follows `userId`. */
async function followerIds(userId) {
  const id = idOf(userId);
  if (!id) return [];
  if (!edgesEnabled()) return legacyArray(id, 'followers');
  return Follow.find({ following: id }).distinct('follower');
}

/** Opaque cursor for a page boundary: edge date plus id, in that order. */
function encodeCursor(row) {
  return `${new Date(row.createdAt || 0).getTime()}_${String(row._id)}`;
}

/** @returns {{createdAt: Date, id: string}|null} */
function decodeCursor(cursor) {
  const [millis, id] = String(cursor || '').split('_');
  if (!/^\d+$/.test(millis || '') || !mongoose.Types.ObjectId.isValid(String(id || ''))) {
    return null;
  }
  return { createdAt: new Date(Number(millis)), id: String(id) };
}

/**
 * One page of a follow list, newest follow first.
 *
 * `cursor` continues exactly after the last row of the previous page. The
 * skip path is for the legacy array fallback and for callers that already use
 * offsets; the HTTP surface returns `nextCursor` and never needs a skip.
 * @param {'followers'|'following'} kind
 * @returns {Promise<{userIds: string[], total: number, hasMore: boolean, nextCursor: string|null}>}
 */
async function followPage(kind, userId, { skip = 0, limit = 20, cursor = null } = {}) {
  const id = idOf(userId);
  const empty = { userIds: [], total: 0, hasMore: false, nextCursor: null };
  if (!id) return empty;

  if (!edgesEnabled()) {
    const ids = uniqueIds(await legacyArray(id, kind));
    const userIds = ids.slice(skip, skip + limit);
    return {
      userIds,
      total: ids.length,
      hasMore: skip + userIds.length < ids.length,
      nextCursor: null,
    };
  }

  const filter = kind === 'followers' ? { following: id } : { follower: id };
  const parsed = decodeCursor(cursor);
  const base = parsed
    ? {
        ...filter,
        $or: [
          { createdAt: { $lt: parsed.createdAt } },
          { createdAt: parsed.createdAt, _id: { $lt: parsed.id } },
        ],
      }
    : filter;

  const rows = await Follow.find(base)
    .sort({ createdAt: -1, _id: -1 })
    .skip(parsed ? 0 : skip)
    .limit(limit + 1)
    .select(kind === 'followers' ? 'follower createdAt' : 'following createdAt')
    .lean();

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const total = await Follow.countDocuments(filter);
  const field = kind === 'followers' ? 'follower' : 'following';

  return {
    userIds: page.map((row) => String(row[field])),
    total,
    hasMore,
    nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]) : null,
  };
}

/** One page of followers, newest follow first. */
function followersPage(userId, options = {}) {
  return followPage('followers', userId, options);
}

/** One page of accounts `userId` follows, newest first. */
function followingPage(userId, options = {}) {
  return followPage('following', userId, options);
}

/** Which of `candidates` this account follows. Bounded by the candidate pool. */
async function followedAmong(userId, candidates) {
  const id = idOf(userId);
  const pool = uniqueIds(candidates);
  if (!id || !pool.length) return [];

  if (!edgesEnabled()) {
    const followed = new Set(uniqueIds(await legacyArray(id, 'following')));
    return pool.filter((candidate) => followed.has(candidate));
  }

  const rows = await Follow.find({ follower: id, following: { $in: pool } })
    .select('following')
    .lean();
  return rows.map((row) => String(row.following));
}

/** Has this user bookmarked this post? */
async function isSaved({ userId, postId }) {
  const user = idOf(userId);
  const post = idOf(postId);
  if (!user || !post) return false;
  if (edgesEnabled()) return Boolean(await SavedPost.exists({ user, post }));
  const ids = await legacyArray(user, 'savedPosts');
  return ids.some((entry) => idOf(entry) === post);
}

/** Saved post ids, most recently saved first. */
async function savedPostIds(userId) {
  const id = idOf(userId);
  if (!id) return [];
  if (!edgesEnabled()) {
    const ids = uniqueIds(await legacyArray(id, 'savedPosts'));
    return ids.reverse();
  }
  const rows = await SavedPost.find({ user: id })
    .sort({ createdAt: -1, _id: -1 })
    .select('post')
    .lean();
  return rows.map((row) => String(row.post));
}

/** Accounts this user blocks. */
async function blockedIds(userId) {
  const id = idOf(userId);
  if (!id) return [];
  if (!edgesEnabled()) {
    return uniqueIds(await legacyArray(id, 'blockedUsers'));
  }
  return (await UserBlock.find({ blocker: id }).distinct('blocked')).map((entry) => String(entry));
}

/** Accounts that block this user. */
async function blockerIds(userId) {
  const id = idOf(userId);
  if (!id) return [];
  if (!edgesEnabled()) {
    // The legacy arrays are only readable in the direction of the owner, so this
    // reverse lookup keeps the query the rest of the code already used.
    const rows = await User.find({ blockedUsers: id }).select('_id').lean();
    return rows.map((row) => String(row._id));
  }
  return (await UserBlock.find({ blocked: id }).distinct('blocker')).map((entry) => String(entry));
}

/** Union of both block directions, for a filter that must hide each side. */
async function hiddenPairIds(userId) {
  if (!idOf(userId)) return [];
  const [outgoing, incoming] = await Promise.all([blockedIds(userId), blockerIds(userId)]);
  return uniqueIds([...outgoing, ...incoming]);
}

/** Is there a block in either direction between the two accounts? */
async function isBlockedPair(firstId, secondId) {
  const first = idOf(firstId);
  const second = idOf(secondId);
  if (!first || !second) return false;
  if (edgesEnabled()) {
    return Boolean(
      await UserBlock.exists({
        $or: [
          { blocker: first, blocked: second },
          { blocker: second, blocked: first },
        ],
      }),
    );
  }
  const [firstDoc, secondDoc] = await Promise.all([
    User.findById(first).select('blockedUsers').lean(),
    User.findById(second).select('blockedUsers').lean(),
  ]);
  const has = (doc, target) => (doc?.blockedUsers || []).some((entry) => idOf(entry) === target);
  return has(firstDoc, second) || has(secondDoc, first);
}

/**
 * Relationship label from the first account's point of view, using edges.
 * Mirrors the pure `relationshipFor` in dmPolicy.
 * @returns {Promise<'mutual'|'follower'|'following'|'stranger'>}
 */
async function relationshipBetween(firstId, secondId) {
  if (!idOf(firstId) || !idOf(secondId)) return 'stranger';
  const [firstFollows, secondFollows] = await Promise.all([
    isFollowing(firstId, secondId),
    isFollowing(secondId, firstId),
  ]);
  if (firstFollows && secondFollows) return 'mutual';
  if (firstFollows) return 'follower';
  if (secondFollows) return 'following';
  return 'stranger';
}

/** Accounts this user muted. */
async function mutedIds(userId) {
  const id = idOf(userId);
  if (!id) return [];
  if (!edgesEnabled()) return uniqueIds(await legacyArray(id, 'mutedUsers'));
  return (await UserMute.find({ muter: id }).distinct('muted')).map((entry) => String(entry));
}

// ── Writes ────────────────────────────────────────────────────────────────

/**
 * Follow the target when not already following.
 * @returns {Promise<{following: boolean, created: boolean}>}
 */
async function follow({ followerId, followingId }) {
  const follower = idOf(followerId);
  const following = idOf(followingId);
  if (!follower || !following || follower === following) {
    return { following: false, created: false };
  }

  const result = await Follow.updateOne(
    { follower, following },
    { $setOnInsert: { follower, following, createdAt: new Date() } },
    { upsert: true },
  );
  const created = result.upsertedCount === 1;

  if (created) {
    await Promise.all([
      User.updateOne({ _id: follower }, { $addToSet: { following: following } }),
      User.updateOne({ _id: following }, { $addToSet: { followers: follower } }),
    ]);
    await recount([follower, following]);
  }

  return { following: true, created };
}

/** Remove the follow edge. Idempotent. */
async function unfollow({ followerId, followingId }) {
  const follower = idOf(followerId);
  const following = idOf(followingId);
  if (!follower || !following) return { following: false, removed: false };

  const result = await Follow.deleteOne({ follower, following });
  const removed = result.deletedCount === 1;

  // The arrays still hold any follow made before the backfill, so clear them
  // even when no edge row existed. Both stores end in the same state either
  // way, and the pull is idempotent.
  await Promise.all([
    User.updateOne({ _id: follower }, { $pull: { following: following } }),
    User.updateOne({ _id: following }, { $pull: { followers: follower } }),
  ]);
  await recount([follower, following]);

  return { following: false, removed };
}

/** Bookmark a post. Idempotent. */
async function savePost({ userId, postId }) {
  const user = idOf(userId);
  const post = idOf(postId);
  if (!user || !post) return { saved: false, created: false };

  const result = await SavedPost.updateOne(
    { user, post },
    { $setOnInsert: { user, post, createdAt: new Date() } },
    { upsert: true },
  );
  const created = result.upsertedCount === 1;

  if (created) {
    await User.updateOne({ _id: user }, { $addToSet: { savedPosts: post } });
    await recount([user]);
  }
  return { saved: true, created };
}

/** Remove a bookmark. Idempotent. */
async function unsavePost({ userId, postId }) {
  const user = idOf(userId);
  const post = idOf(postId);
  if (!user || !post) return { saved: false, removed: false };

  const result = await SavedPost.deleteOne({ user, post });
  const removed = result.deletedCount === 1;
  // A bookmark made before the backfill has no edge row yet; the array is the
  // copy that still has it.
  await User.updateOne({ _id: user }, { $pull: { savedPosts: post } });
  await recount([user]);
  return { saved: false, removed };
}

/**
 * Block an account.
 *
 * A block also drops follow edges in both directions, so an old follow cannot
 * keep putting a blocked account in a feed. The conversation state change stays
 * with the caller, which owns DM policy.
 * @returns {Promise<{created: boolean}>}
 */
async function block({ blockerId, blockedId }) {
  const blocker = idOf(blockerId);
  const blocked = idOf(blockedId);
  if (!blocker || !blocked || blocker === blocked) return { created: false };

  const result = await UserBlock.updateOne(
    { blocker, blocked },
    { $setOnInsert: { blocker, blocked, createdAt: new Date() } },
    { upsert: true },
  );
  const created = result.upsertedCount === 1;

  if (created) {
    // A follow from before the backfill has no edge row yet, so the array pull
    // runs too; a follow that survives a block would keep the blocked account
    // in a feed.
    await Promise.all([
      User.updateOne({ _id: blocker }, { $addToSet: { blockedUsers: blocked } }),
      Follow.deleteMany({
        $or: [
          { follower: blocker, following: blocked },
          { follower: blocked, following: blocker },
        ],
      }),
      User.updateOne({ _id: blocker }, { $pull: { following: blocked, followers: blocked } }),
      User.updateOne({ _id: blocked }, { $pull: { following: blocker, followers: blocker } }),
    ]);
    await recount([blocker, blocked]);
  }

  return { created };
}

/** Remove a block. Follows dropped by the block are not restored. */
async function unblock({ blockerId, blockedId }) {
  const blocker = idOf(blockerId);
  const blocked = idOf(blockedId);
  if (!blocker || !blocked) return { removed: false };

  const result = await UserBlock.deleteOne({ blocker, blocked });
  const removed = result.deletedCount === 1;
  // The array copy may predate the backfill, so it is cleared either way. A
  // stale entry would keep the account blocked in the reader's own filters.
  await User.updateOne({ _id: blocker }, { $pull: { blockedUsers: blocked } });
  return { removed };
}

/** Mute an account for the caller's own view. Idempotent. */
async function mute({ muterId, mutedId }) {
  const muter = idOf(muterId);
  const muted = idOf(mutedId);
  if (!muter || !muted || muter === muted) return { created: false };

  const result = await UserMute.updateOne(
    { muter, muted },
    { $setOnInsert: { muter, muted, createdAt: new Date() } },
    { upsert: true },
  );
  const created = result.upsertedCount === 1;
  if (created) {
    await User.updateOne({ _id: muter }, { $addToSet: { mutedUsers: muted } });
  }
  return { created };
}

/** Remove a mute. Idempotent. */
async function unmute({ muterId, mutedId }) {
  const muter = idOf(muterId);
  const muted = idOf(mutedId);
  if (!muter || !muted) return { removed: false };

  const result = await UserMute.deleteOne({ muter, muted });
  const removed = result.deletedCount === 1;
  // Same as unblock: a mute made before the backfill exists only in the array.
  await User.updateOne({ _id: muter }, { $pull: { mutedUsers: muted } });
  return { removed };
}

/** Deleted posts must stop appearing in every saved list. */
async function removeSavedForPosts(postIds) {
  const posts = uniqueIds(postIds);
  if (!posts.length) return { users: 0 };

  const rows = await SavedPost.find({ post: { $in: posts } })
    .select('user')
    .lean();
  if (!rows.length) return { users: 0 };

  const users = uniqueIds(rows.map((row) => row.user));
  await Promise.all([
    SavedPost.deleteMany({ post: { $in: posts } }),
    User.updateMany({ _id: { $in: users } }, { $pull: { savedPosts: { $in: posts } } }),
  ]);
  await recount(users);
  return { users: users.length };
}

/** One deleted post. */
function removeSavedForPost(postId) {
  return removeSavedForPosts([postId]);
}

/**
 * Remove every relationship an erased account appears in, on either side.
 * The caller has already handled the account's own document and posts.
 */
async function eraseRelations(userId) {
  const id = idOf(userId);
  if (!id) return;

  const [incomingFollows, outgoingFollows] = await Promise.all([
    Follow.find({ following: id }).select('follower').lean(),
    Follow.find({ follower: id }).select('following').lean(),
  ]);
  const affected = uniqueIds([
    ...incomingFollows.map((row) => row.follower),
    ...outgoingFollows.map((row) => row.following),
  ]);

  await Promise.all([
    Follow.deleteMany({ $or: [{ follower: id }, { following: id }] }),
    SavedPost.deleteMany({ user: id }),
    UserBlock.deleteMany({ $or: [{ blocker: id }, { blocked: id }] }),
    UserMute.deleteMany({ $or: [{ muter: id }, { muted: id }] }),
    // The array copies on other accounts are legacy rollback state.
    User.updateMany(
      { _id: { $ne: id } },
      { $pull: { followers: id, following: id, blockedUsers: id, mutedUsers: id } },
    ),
  ]);

  const remaining = affected.filter((entry) => entry !== id);
  if (remaining.length) await recount(remaining);
}

module.exports = {
  edgesEnabled,
  idOf,
  uniqueIds,
  recount,
  countsFor,
  isFollowing,
  followedIds,
  followerIds,
  followersPage,
  followingPage,
  followedAmong,
  isSaved,
  savedPostIds,
  blockedIds,
  blockerIds,
  hiddenPairIds,
  isBlockedPair,
  relationshipBetween,
  mutedIds,
  follow,
  unfollow,
  savePost,
  unsavePost,
  block,
  unblock,
  mute,
  unmute,
  removeSavedForPost,
  removeSavedForPosts,
  eraseRelations,
};
