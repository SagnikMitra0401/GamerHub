/**
 * What a transaction costs.
 *
 * Step 4 allows 15 ms of added p95 latency per wrapped flow. This measures that
 * number on the configured cluster: the same two-operation unit, run 100 times
 * without a transaction and 100 times inside one. The unit's own round trips are
 * identical in both arms, so the difference is the cost of wrapping a flow —
 * starting the session and committing it.
 *
 *   node scripts/tx-benchmark.js
 *   TX_BENCH_ASSERT=1 node scripts/tx-benchmark.js   # enforce the 15 ms budget
 *
 * The cluster is remote, so the absolute numbers include the network. Compare
 * the two arms, not the total.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DB = `gamerhub_txbench_${Date.now().toString(36)}`;
const RUNS = Number(process.env.TX_BENCH_RUNS || 100);
const WARMUP = 5;
const BUDGET_MS = 15;

const url = new URL(process.env.MONGO_URI);
url.pathname = `/${DB}`;
process.env.MONGO_URI = url.toString();
process.env.NODE_ENV = 'test';
process.env.DISABLE_RETENTION_WORKER = '1';

const connectDB = require('../server/config/db');
const User = require('../server/models/User');
const Conversation = require('../server/models/Conversation');
const {
  withTransaction,
  transactionsSupported,
  resetTransactionSupport,
} = require('../server/utils/transaction');

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function main() {
  await connectDB();
  if (!(await transactionsSupported())) {
    throw new Error('This benchmark needs a replica set; the deployment has none.');
  }

  const user = await User.create({
    username: 'txbenchmarker',
    email: 'txbenchmarker@example.com',
    passwordHash: 'not-a-real-hash',
  });
  const pairKey = `bench:${user._id}`;

  /** One read and one write: the smallest multi-document flow. */
  const unit = async (round) => {
    await User.findById(user._id).select('_id').lean();
    await Conversation.updateOne(
      { pairKey },
      { $set: { state: 'active', contextLabel: `round-${round}` } },
      { upsert: true },
    );
  };

  // The whole call is timed, session start and commit included. Timing only
  // the callback would hide the very cost this script exists to measure.
  const runArm = async (transactional) => {
    const samples = [];
    const once = async (round) => {
      const started = process.hrtime.bigint();
      if (transactional) await withTransaction(() => unit(round));
      else await unit(round);
      return Number(process.hrtime.bigint() - started) / 1e6;
    };
    for (let i = 0; i < WARMUP; i += 1) {
      await once(i);
    }
    for (let i = 0; i < RUNS; i += 1) {
      samples.push(await once(i));
    }
    return samples;
  };

  process.env.TRANSACTIONS = 'off';
  resetTransactionSupport();
  const baseline = await runArm(false);
  delete process.env.TRANSACTIONS;
  resetTransactionSupport();
  const wrapped = await runArm(true);

  const p50 = percentile(wrapped, 50) - percentile(baseline, 50);
  const p95 = percentile(wrapped, 95) - percentile(baseline, 95);
  const medianWrapped = percentile(wrapped, 50);
  const medianBaseline = percentile(baseline, 50);
  const p95Wrapped = percentile(wrapped, 95);
  const p95Baseline = percentile(baseline, 95);

  console.log(`runs per arm: ${RUNS}`);
  console.log(`sequential: p50 ${medianBaseline.toFixed(1)} ms, p95 ${p95Baseline.toFixed(1)} ms`);
  console.log(`transaction: p50 ${medianWrapped.toFixed(1)} ms, p95 ${p95Wrapped.toFixed(1)} ms`);
  console.log(`added latency: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);

  if (process.env.TX_BENCH_ASSERT === '1') {
    if (p95 > BUDGET_MS) {
      console.error(`p95 overhead ${p95.toFixed(1)} ms exceeds the ${BUDGET_MS} ms budget`);
      process.exitCode = 1;
    } else {
      console.log(`p95 overhead is within the ${BUDGET_MS} ms budget`);
    }
  }

  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
