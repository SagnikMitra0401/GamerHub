/**
 * Buffered like writes.
 *
 * A viral post can take hundreds of like toggles a minute. Each toggle used to
 * cost two MongoDB round-trips (exists + findByIdAndUpdate). Here the toggle is
 * recorded in a Redis hash and a worker folds everything into one bulkWrite
 * every few seconds, so N likes cost O(distinct posts) writes instead of 2N.
 *
 * Why a hash instead of the list in the original sketch:
 *   - `HSET postId:userId like|unlike` is last-write-wins, so rapid
 *     like → unlike → like collapses correctly instead of being replayed in
 *     order by the flusher.
 *   - The controller can read the pending action with one HGET, which is what
 *     keeps the response honest while the database is still a few seconds
 *     behind.
 *
 * The hash grows only between flushes; every processed field is removed with a
 * single HDEL. If the bulkWrite fails, fields are kept for the next tick.
 */
const mongoose = require('mongoose');
const Post = require('../models/Post');
const { getRedis, redisKey } = require('../config/redis');
const { awardXp } = require('./gamification');

const BUFFER_KEY = 'likebuf';   // hash: "<postId>:<userId>" -> "like" | "unlike"
const VIRAL_KEY = 'viral:10';   // set of posts already granted the 10-like medal
const FLUSH_INTERVAL_MS = 5000;   // while work is flowing
const IDLE_INTERVAL_MS = 60_000;  // no work: one HGETALL a minute, not twelve
const MAX_IDLE_INTERVAL_MS = 60_000;
const FLUSH_BATCH = 200;

const fieldFor = (postId, userId) => `${String(postId)}:${String(userId)}`;

let timer = null;
let flushing = false;
let localPending = 0;
let nextDelay = FLUSH_INTERVAL_MS;

function bufferHandle() {
  const redis = getRedis();
  if (!redis) return null;
  return { redis, key: redisKey(BUFFER_KEY), viralKey: redisKey(VIRAL_KEY) };
}

/**
 * The pending action for one author/post pair, or null when nothing is queued.
 * Used by the controller so a second click within the flush window flips the
 * state the user is actually looking at.
 */
async function readPendingLike(postId, userId) {
  const buffer = bufferHandle();
  if (!buffer) return null;
  try {
    const action = await buffer.redis.hget(buffer.key, fieldFor(postId, userId));
    return action === 'like' || action === 'unlike' ? action : null;
  } catch (err) {
    console.error('[likeBuffer] read failed:', err.message);
    return null;
  }
}

/**
 * Queue one toggle. Returns false when Redis is unavailable or the write
 * failed — the caller must then write to MongoDB directly so the action is
 * never silently dropped.
 */
async function bufferLikeEvent(postId, userId, action) {
  if (action !== 'like' && action !== 'unlike') return false;
  const buffer = bufferHandle();
  if (!buffer) return false;

  try {
    await buffer.redis.hset(buffer.key, { [fieldFor(postId, userId)]: action });
    // Wake an idle worker immediately: a burst should not wait up to a minute.
    localPending += 1;
    if (timer && nextDelay > FLUSH_INTERVAL_MS) {
      nextDelay = FLUSH_INTERVAL_MS;
      scheduleNext();
    }
    return true;
  } catch (err) {
    console.error('[likeBuffer] queue failed, writing directly:', err.message);
    return false;
  }
}

/**
 * Pipeline update: add/remove the id, then recompute `likeCount` from the
 * resulting array. Recomputing instead of `$inc` keeps the denormalised field
 * exact even if the same event is applied twice.
 */
function likePipeline({ adds = [], removes = [] }) {
  const stages = [];
  if (adds.length) {
    stages.push({ $set: { likes: { $setUnion: [{ $ifNull: ['$likes', []] }, adds] } } });
  }
  if (removes.length) {
    stages.push({ $set: { likes: { $setDifference: [{ $ifNull: ['$likes', []] }, removes] } } });
  }
  stages.push({ $set: { likeCount: { $size: '$likes' } } });
  return stages;
}

/**
 * Drain up to FLUSH_BATCH queued toggles and apply them in one bulkWrite.
 * @returns {Promise<number>} number of queued events applied
 */
async function flushLikeBuffer() {
  const buffer = bufferHandle();
  if (!buffer || flushing) return 0;

  flushing = true;
  try {
    const pending = await buffer.redis.hgetall(buffer.key);
    const fields = Object.keys(pending || {});
    if (!fields.length) return 0;

    const batch = fields.slice(0, FLUSH_BATCH);
    const byPost = new Map();

    for (const field of batch) {
      const separator = field.indexOf(':');
      if (separator < 1) continue;

      const postId = field.slice(0, separator);
      const userId = field.slice(separator + 1);
      if (!mongoose.Types.ObjectId.isValid(postId) || !mongoose.Types.ObjectId.isValid(userId)) continue;

      const action = pending[field];
      if (action !== 'like' && action !== 'unlike') continue;

      const group = byPost.get(postId) || { adds: [], removes: [] };
      const id = new mongoose.Types.ObjectId(userId);
      if (action === 'like') group.adds.push(id);
      else group.removes.push(id);
      byPost.set(postId, group);
    }

    if (byPost.size) {
      const ops = [...byPost.entries()].map(([postId, group]) => ({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(postId) },
          update: likePipeline(group)
        }
      }));

      // Throwing here keeps the events queued for the next tick; every stage is
      // idempotent, so a partial retry is safe.
      await Post.bulkWrite(ops, { ordered: false });

      await awardViralMedals(buffer, [...byPost.keys()]);
    }

    await buffer.redis.hdel(buffer.key, ...batch);
    return batch.length;
  } catch (err) {
    console.error('[likeBuffer] flush failed, keeping queued events:', err.message);
    return -1;
  } finally {
    flushing = false;
  }
}

/** One-time medal per post, tracked in Redis so retries cannot re-award XP. */
async function awardViralMedals(buffer, postIds) {
  try {
    const winners = await Post.find({ _id: { $in: postIds }, likeCount: 10 })
      .select('userId')
      .lean();
    for (const post of winners) {
      const first = await buffer.redis.sadd(buffer.viralKey, String(post._id));
      if (first === 1) await awardXp(post.userId, 50, 'viral_gamer');
    }
  } catch (err) {
    // Gamification is never allowed to fail a write.
    console.error('[likeBuffer] medal check failed:', err.message);
  }
}

/**
 * Periodic worker with adaptive backoff.
 *
 * A fixed 5s interval costs 17k Redis commands a day even when nobody likes
 * anything, which is more than the Upstash free tier allows. Here an idle
 * worker polls once a minute and returns to 5s the moment an event is queued
 * (in this process) or a flush finds work. Total idle cost: ~1.4k commands/day.
 *
 * No Redis → nothing is ever queued, so no timer is started.
 */
async function flushTick() {
  let written = 0;
  try {
    written = await flushLikeBuffer();
  } catch (err) {
    console.error('[likeBuffer] worker error:', err.message);
    written = -1;
  }

  // Work found, work queued locally, or a failed flush: stay at 5s. Otherwise
  // back off so idle hours cost one command a minute instead of twelve.
  if (written > 0 || written === -1 || localPending > 0) {
    nextDelay = FLUSH_INTERVAL_MS;
  } else {
    nextDelay = Math.min(nextDelay * 2, MAX_IDLE_INTERVAL_MS);
  }
  localPending = 0;
  scheduleNext();
}

function scheduleNext() {
  if (!timer) return;
  clearTimeout(timer);
  timer = setTimeout(flushTick, nextDelay);
  timer.unref?.();
}

function startLikeFlushWorker() {
  if (process.env.DISABLE_LIKE_BUFFER === '1') return null;
  if (!getRedis()) return null;
  if (timer) return timer;

  nextDelay = FLUSH_INTERVAL_MS;
  localPending = 0;

  // Truthy sentinel: scheduleNext and the queue hint both treat a set `timer`
  // as "worker running" before the first timeout exists.
  timer = { pending: true };
  scheduleNext();
  return timer;
}

function stopLikeFlushWorker() {
  if (timer) clearTimeout(timer);
  timer = null;
  nextDelay = FLUSH_INTERVAL_MS;
  localPending = 0;
}

/** Whether buffered writes are actually in use (drives the admin dashboard). */
function isLikeWorkerRunning() {
  return Boolean(timer);
}

module.exports = {
  bufferLikeEvent,
  readPendingLike,
  flushLikeBuffer,
  likePipeline,
  startLikeFlushWorker,
  stopLikeFlushWorker,
  isLikeWorkerRunning,
  FLUSH_INTERVAL_MS,
  IDLE_INTERVAL_MS,
  FLUSH_BATCH,
  BUFFER_KEY
};
