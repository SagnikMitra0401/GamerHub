/**
 * Batched, resumable backfill harness.
 *
 * Backfills are deliberately separate from `migrate-mongo`: a migration should
 * change structure (and be quick), while a backfill walks data and must be
 * throttled, idempotent and resumable. This helper runs a cursor in pages,
 * records a checkpoint after each page, supports `--dry-run`, and never loads
 * the whole collection into memory.
 *
 * Usage:
 *   const { runBackfill } = require('./lib/backfill');
 *   await runBackfill({ model: Post, filter: { mediaAssetId: null },
 *     apply: async (docs) => { ... }, checkpointKey: 'post-media-v1' });
 */
const mongoose = require('mongoose');

const DEFAULT_BATCH = 500;

function checkpointCollection() {
  return mongoose.connection.collection('backfill_checkpoints');
}

async function readCheckpoint(key) {
  if (!key) return null;
  const row = await checkpointCollection().findOne({ _id: key });
  return row?.lastId || null;
}

async function writeCheckpoint(key, lastId, processed) {
  if (!key) return;
  await checkpointCollection().updateOne(
    { _id: key },
    { $set: { lastId, processed, updatedAt: new Date() } },
    { upsert: true },
  );
}

/**
 * @param {object} options
 * @param {import('mongoose').Model} options.model
 * @param {object} [options.filter]
 * @param {(docs: object[]) => Promise<number|void>} options.apply
 * @param {number} [options.batchSize]
 * @param {string} [options.checkpointKey]
 * @param {boolean} [options.dryRun]
 * @param {number} [options.throttleMs]
 * @param {(message: string) => void} [options.log]
 */
async function runBackfill({
  model,
  filter = {},
  apply,
  batchSize = DEFAULT_BATCH,
  checkpointKey = null,
  dryRun = false,
  throttleMs = 25,
  log = console.log,
}) {
  if (!model || typeof apply !== 'function') {
    throw new Error('runBackfill needs a model and an apply(docs) function');
  }

  const total = await model.countDocuments(filter);
  const resumeFrom = dryRun ? null : await readCheckpoint(checkpointKey);
  const query = { ...filter };
  // _id ordering is stable and index-backed; createdAt can tie.
  if (resumeFrom) query._id = { ...(query._id || {}), $gt: resumeFrom };

  let processed = 0;
  let lastId = resumeFrom;

  for (;;) {
    const docs = await model.find(query).sort({ _id: 1 }).limit(batchSize).lean();
    if (!docs.length) break;

    if (!dryRun) {
      const changed = await apply(docs);
      processed += Number(changed) || docs.length;
      lastId = docs[docs.length - 1]._id;
      await writeCheckpoint(checkpointKey, lastId, processed);
    } else {
      processed += docs.length;
      lastId = docs[docs.length - 1]._id;
    }

    log(`  ${dryRun ? 'would process' : 'processed'} ${processed}/${total} (last ${lastId})`);
    query._id = { ...(query._id || {}), $gt: lastId };

    if (throttleMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, throttleMs));
    }
  }

  return { total, processed, dryRun, lastId };
}

module.exports = { runBackfill, readCheckpoint, writeCheckpoint, DEFAULT_BATCH };
