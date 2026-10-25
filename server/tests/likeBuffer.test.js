/**
 * Unit tests for the buffered like path.
 *
 * Redis is faked (in-memory, installable in front of the real client module) and
 * the Post model is a two-method stub, so this file never needs a database or a
 * network — it runs in CI and on a plane. The integration behaviour (a real
 * click flipping a real post's `likes`) is already covered by
 * `scripts/e2e-phase6.js`; what is checked here is the logic that suite cannot
 * see: last-write-wins collapsing, idempotent pipelines, retry-on-failure and
 * the one-time viral medal.
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { installFakeRedis, enableRedis, disableRedis, store } = require('./helpers/fakeRedis');

// ── Stubs, installed before the module under test is required ──────────────

const redisStore = installFakeRedis();

const postStub = {
  writes: [],
  failWrites: 0,
  viralWinners: [],
  async bulkWrite(ops, options) {
    this.writes.push({ ops, options });
    if (this.failWrites > 0) {
      this.failWrites -= 1;
      throw new Error('bulkWrite failed');
    }
    return { ok: 1 };
  },
  find() {
    return {
      select() { return this; },
      async lean() { return postStub.viralWinners; }
    };
  },
  reset() {
    this.writes.length = 0;
    this.failWrites = 0;
    this.viralWinners = [];
  }
};

const awarded = [];
const gamificationStub = {
  awardXp: async (userId, xp, medal) => { awarded.push({ userId, xp, medal }); }
};

function stubModule(request, exports) {
  const resolved = require.resolve(request);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

stubModule('../models/Post', postStub);
stubModule('../utils/gamification', gamificationStub);

const likeBuffer = require('../utils/likeBuffer');
const { resetRedis } = require('../config/redis');
const { BUFFER_KEY, FLUSH_BATCH } = likeBuffer;
const KEY = `gamerhub:${BUFFER_KEY}`;
const VIRAL_KEY = 'gamerhub:viral:10';

const POST_A = '65f000000000000000000001';
const POST_B = '65f000000000000000000002';
const USER_A = '65f0000000000000000000a1';
const USER_B = '65f0000000000000000000a2';
const USER_C = '65f0000000000000000000a3';

// The module logs expected failures (it is designed to survive them); keeping
// those out of the reporter output is the only reason this hook exists.
const realConsoleError = console.error;
before(() => { console.error = () => {}; });
after(() => { console.error = realConsoleError; });

beforeEach(() => {
  redisStore.reset();
  postStub.reset();
  awarded.length = 0;
  likeBuffer.stopLikeFlushWorker();
  resetRedis();
  disableRedis();
});

// ── Feature switch and queueing ────────────────────────────────────────────

test('bufferLikeEvent reports "write directly" when the switch is off', async () => {
  enableRedis();
  disableRedis();

  assert.equal(await likeBuffer.bufferLikeEvent(POST_A, USER_A, 'like'), false);
  assert.equal(redisStore.calls.length, 0);
  assert.equal(await likeBuffer.readPendingLike(POST_A, USER_A), null);
});

test('bufferLikeEvent rejects an action it does not understand', async () => {
  enableRedis();
  assert.equal(await likeBuffer.bufferLikeEvent(POST_A, USER_A, 'shrug'), false);
  assert.equal(redisStore.hash(KEY).size, 0);
});

test('a repeated toggle collapses to the last write', async () => {
  enableRedis();

  await likeBuffer.bufferLikeEvent(POST_A, USER_A, 'like');
  await likeBuffer.bufferLikeEvent(POST_A, USER_A, 'unlike');
  await likeBuffer.bufferLikeEvent(POST_A, USER_A, 'like');
  await likeBuffer.bufferLikeEvent(POST_A, USER_A, 'unlike');

  assert.equal(redisStore.hash(KEY).get(`${POST_A}:${USER_A}`), 'unlike');
  assert.equal(await likeBuffer.readPendingLike(POST_A, USER_A), 'unlike');
  assert.equal(redisStore.hash(KEY).size, 1, 'one field per author/post pair');
});

test('readPendingLike ignores a field it cannot interpret', async () => {
  enableRedis();
  redisStore.hash(KEY).set(`${POST_A}:${USER_A}`, 'maybe');
  assert.equal(await likeBuffer.readPendingLike(POST_A, USER_A), null);
});

// ── Pipeline shape ─────────────────────────────────────────────────────────

test('likePipeline recomputes likeCount instead of incrementing it', () => {
  const adds = likeBuffer.likePipeline({ adds: [USER_A, USER_B] });
  assert.deepEqual(adds[0], { $set: { likes: { $setUnion: [{ $ifNull: ['$likes', []] }, [USER_A, USER_B]] } } });
  assert.deepEqual(adds.at(-1), { $set: { likeCount: { $size: '$likes' } } });

  const removes = likeBuffer.likePipeline({ removes: [USER_A] });
  assert.deepEqual(removes[0], { $set: { likes: { $setDifference: [{ $ifNull: ['$likes', []] }, [USER_A]] } } });
  assert.deepEqual(removes.at(-1), { $set: { likeCount: { $size: '$likes' } } });

  const mixed = likeBuffer.likePipeline({ adds: [USER_A], removes: [USER_B] });
  assert.equal(mixed.length, 3, 'add, remove, then recount');
  assert.deepEqual(mixed[2], { $set: { likeCount: { $size: '$likes' } } });

  // A no-op group still recounts, so a replay can never drift the count.
  assert.deepEqual(likeBuffer.likePipeline({}), [{ $set: { likeCount: { $size: '$likes' } } }]);
});

// ── Flushing ───────────────────────────────────────────────────────────────

test('flush folds many events into one bulkWrite per post', async () => {
  enableRedis();

  await likeBuffer.bufferLikeEvent(POST_A, USER_A, 'like');
  await likeBuffer.bufferLikeEvent(POST_A, USER_B, 'like');
  await likeBuffer.bufferLikeEvent(POST_B, USER_C, 'like');
  await likeBuffer.bufferLikeEvent(POST_B, USER_A, 'unlike');

  const applied = await likeBuffer.flushLikeBuffer();

  assert.equal(applied, 4);
  assert.equal(postStub.writes.length, 1, 'one round-trip for the whole batch');
  assert.equal(postStub.writes[0].options.ordered, false);

  const ops = postStub.writes[0].ops;
  assert.equal(ops.length, 2);

  const byId = Object.fromEntries(ops.map(op => [String(op.updateOne.filter._id), op.updateOne.update]));
  const postA = byId[POST_A].map(stage => Object.keys(stage.$set)[0]);
  assert.deepEqual(postA, ['likes', 'likeCount']);
  assert.equal(byId[POST_A][0].$set.likes.$setUnion[1].length, 2, 'two likes for post A');

  assert.equal(byId[POST_B][0].$set.likes.$setUnion[1].length, 1);
  assert.equal(byId[POST_B][1].$set.likes.$setDifference[1].length, 1);

  assert.equal(redisStore.hash(KEY).size, 0, 'processed fields are removed');
  assert.equal(redisStore.count('hdel'), 1);
});

test('a failed write leaves every event queued for the next tick', async () => {
  enableRedis();
  await likeBuffer.bufferLikeEvent(POST_A, USER_A, 'like');
  await likeBuffer.bufferLikeEvent(POST_A, USER_B, 'like');

  postStub.failWrites = 1;
  const applied = await likeBuffer.flushLikeBuffer();

  assert.equal(applied, -1);
  assert.equal(redisStore.hash(KEY).size, 2, 'nothing was dropped');
  assert.equal(redisStore.count('hdel'), 0);

  // The retry applies the same two events without double-counting, because the
  // pipeline unions ids instead of incrementing a number.
  const retried = await likeBuffer.flushLikeBuffer();
  assert.equal(retried, 2);
  assert.equal(redisStore.hash(KEY).size, 0);
});

test('malformed fields are skipped without failing the flush', async () => {
  enableRedis();
  await likeBuffer.bufferLikeEvent(POST_A, USER_A, 'like');

  const hash = redisStore.hash(KEY);
  hash.set('not-an-id:also-not-an-id', 'like');
  hash.set(`${POST_B}:${USER_B}`, 'sideways');

  const applied = await likeBuffer.flushLikeBuffer();

  assert.equal(applied, 3, 'the whole batch is acknowledged');
  assert.equal(postStub.writes.length, 1);
  assert.equal(postStub.writes[0].ops.length, 1, 'only the valid pair reached Mongo');
  assert.equal(String(postStub.writes[0].ops[0].updateOne.filter._id), POST_A);
  assert.equal(redisStore.hash(KEY).size, 0, 'junk is cleared too, not retried forever');
});

test('the batch size caps how much one tick writes', async () => {
  enableRedis();
  const hash = redisStore.hash(KEY);
  for (let i = 0; i < FLUSH_BATCH + 3; i += 1) {
    hash.set(`${POST_A}:${String(i).padStart(24, '0')}`, 'like');
  }

  const applied = await likeBuffer.flushLikeBuffer();

  assert.equal(applied, FLUSH_BATCH);
  assert.equal(hash.size, 3, 'the remainder waits for the next tick');
});

test('an empty buffer costs one read and no write', async () => {
  enableRedis();
  assert.equal(await likeBuffer.flushLikeBuffer(), 0);
  assert.equal(postStub.writes.length, 0);
  assert.equal(redisStore.count('hdel'), 0);
});

test('flush is a no-op when Redis is off', async () => {
  assert.equal(await likeBuffer.flushLikeBuffer(), 0);
  assert.equal(redisStore.calls.length, 0);
});

// ── Gamification ───────────────────────────────────────────────────────────

test('the viral medal is granted once per post, even across ticks', async () => {
  enableRedis();
  postStub.viralWinners = [{ _id: POST_A, userId: USER_B }];

  await likeBuffer.bufferLikeEvent(POST_A, USER_A, 'like');
  await likeBuffer.flushLikeBuffer();

  assert.equal(awarded.length, 1);
  assert.deepEqual(awarded[0], { userId: USER_B, xp: 50, medal: 'viral_gamer' });
  assert.ok(redisStore.setMembers(VIRAL_KEY).has(POST_A));

  // A second tick that re-reaches ten likes must not award again.
  await likeBuffer.bufferLikeEvent(POST_A, USER_C, 'unlike');
  await likeBuffer.flushLikeBuffer();

  assert.equal(awarded.length, 1);
  assert.equal(redisStore.count('sadd'), 2);
});

test('a failing medal check never fails the flush', async () => {
  enableRedis();
  postStub.viralWinners = [{ _id: POST_A, userId: USER_B }];
  redisStore.failCommands.add('sadd');

  await likeBuffer.bufferLikeEvent(POST_A, USER_A, 'like');

  assert.equal(await likeBuffer.flushLikeBuffer(), 1);
  assert.equal(awarded.length, 0);
  assert.equal(redisStore.hash(KEY).size, 0, 'the like itself was still persisted');
});

// ── Worker lifecycle ───────────────────────────────────────────────────────

test('the worker does not start without Redis', () => {
  assert.equal(likeBuffer.startLikeFlushWorker(), null);
  assert.equal(likeBuffer.isLikeWorkerRunning(), false);
});

test('the worker can be disabled explicitly, and stops cleanly', () => {
  enableRedis();
  process.env.DISABLE_LIKE_BUFFER = '1';
  try {
    assert.equal(likeBuffer.startLikeFlushWorker(), null);
    assert.equal(likeBuffer.isLikeWorkerRunning(), false);
  } finally {
    delete process.env.DISABLE_LIKE_BUFFER;
  }

  likeBuffer.startLikeFlushWorker();
  assert.equal(likeBuffer.isLikeWorkerRunning(), true);

  // Starting twice must not install a second timer.
  const first = likeBuffer.startLikeFlushWorker();
  assert.equal(first, likeBuffer.startLikeFlushWorker());

  likeBuffer.stopLikeFlushWorker();
  assert.equal(likeBuffer.isLikeWorkerRunning(), false);
});

test('idle polling backs off well beyond the busy interval', () => {
  assert.ok(likeBuffer.IDLE_INTERVAL_MS > likeBuffer.FLUSH_INTERVAL_MS * 5,
    'an idle worker must not poll every five seconds');
});
