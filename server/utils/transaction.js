/**
 * Multi-document writes, one commit.
 *
 * Several flows write more than one document. A process that dies between the
 * writes leaves state nobody can repair from the outside: an account claimed as
 * deleted while its posts remain, a conversation marked active with no first
 * message, an invitation accepted without the membership it promised.
 *
 * `withTransaction(fn)` runs `fn` inside a MongoDB transaction when the
 * deployment can carry one — a replica set or a sharded cluster. The callback
 * receives the session; every write that should be part of the commit passes
 * `sessionOptions(Model, session)` as its options.
 *
 * Mongoose's async-local storage applies the session to every operation started
 * inside the callback, so a helper that never receives a session still joins
 * the commit. The squad-chat domain may run on a second driver connection
 * (`server/config/connections.js`), and MongoDB refuses a session from another
 * client. `sessionOptions` therefore pins a write on that connection to no
 * session. Such a write cannot join the commit, so it must not pretend to: the
 * callback registers it with `defer` and it runs only after the commit has
 * succeeded. An aborted transaction then leaves no half of the pair behind — no
 * squad member in a chat for a membership that rolled back.
 *
 * A standalone server has no transactions. The helper then runs the same code
 * path with no session and logs a single warning, because sequential writes are
 * the best that deployment can do. `TRANSACTIONS=off` forces that path, which
 * is also how the fallback is tested.
 *
 * MongoDB bounds a transaction twice: it must finish inside
 * `transactionLifetimeLimitSeconds` (60 seconds by default) and its combined
 * oplog entry must fit in one 16 MB document. Work that is too large for either
 * — an account erasure with years of content — is more useful finished than
 * refused, so `fallbackOnLimit` repeats the callback outside a transaction when
 * the server rejects it for those reasons. Owning code must be safe to repeat;
 * the erasure claims the account before it writes, so a retry is a no-op on the
 * parts it already did.
 *
 * Reads inside the callback see the transaction's own uncommitted writes when
 * they pass the session, so a flow that re-reads a row it just changed stays
 * consistent.
 */

const mongoose = require('mongoose');

// Every operation in a transaction callback inherits its session unless it
// names one itself. One write does not have to remember to ask.
mongoose.set('transactionAsyncLocalStorage', true);

// Server errors that mean "this commit is too big or too slow", not "this code
// is wrong": TransactionTooLarge, ExceededTimeLimit, MaxTimeMSExpired, and the
// NoSuchTransaction abort the lifetime limit causes.
const LIMIT_CODES = new Set([50, 220, 262]);
const LIMIT_MESSAGE =
  /too large to fit in the oplog|exceeded time limit|transaction .* has been aborted/i;

let supported = null;
let warned = false;
let limitWarned = false;

function forcedOff() {
  return String(process.env.TRANSACTIONS || '').toLowerCase() === 'off';
}

function warnFallback() {
  if (warned) return;
  warned = true;
  console.warn(
    '[transactions] this deployment has no replica set; multi-write flows run sequentially and cannot roll back.',
  );
}

function warnLimit(err) {
  if (limitWarned) return;
  limitWarned = true;
  console.warn(
    `[transactions] this unit is too large for one transaction (${err.message}); it is repeated outside the transaction and cannot roll back.`,
  );
}

/**
 * Whether the connected deployment can run a transaction.
 *
 * The probe is cached because it costs a round trip and the topology does not
 * change under a running process. `hello` is answered without authentication
 * and names the topology: `setName` for a replica set, `isdbgrid` for a
 * sharded cluster.
 */
async function transactionsSupported() {
  if (forcedOff()) return false;
  if (supported !== null) return supported;

  const db = mongoose.connection.db;
  // Not connected yet: answer for this call without caching a false verdict.
  if (!db) return false;

  try {
    const hello = await db.admin().command({ hello: 1 });
    supported = Boolean(hello.setName || hello.msg === 'isdbgrid');
  } catch {
    supported = false;
  }

  if (!supported) warnFallback();
  return supported;
}

/**
 * Options for one write: the session when the model shares the transaction's
 * client, an explicit none when it does not.
 *
 * `{ session: null }` is not decoration. Async-local storage only fills a
 * session that the options do not mention, so naming `null` is how a write on
 * the squad-chat connection opts out of a session from the main client.
 *
 * @param {object | null} model a Mongoose model
 * @param {import('mongoose').ClientSession | null} session
 * @returns {{session?: import('mongoose').ClientSession | null}}
 */
function sessionOptions(model, session) {
  if (!session) return {};
  return model?.db === mongoose.connection ? { session } : { session: null };
}

/** True when the server refused the commit for its size or its lifetime. */
function transactionLimitError(err) {
  if (!err) return false;
  if (LIMIT_CODES.has(Number(err.code))) return true;
  return LIMIT_MESSAGE.test(String(err.message || ''));
}

/** Run after-commit work, one task at a time. */
async function runDeferred(tasks) {
  for (const task of tasks) {
    try {
      await task();
    } catch (err) {
      // The commit already happened. Reporting the request as failed would
      // invite a retry that repeats the committed writes, so this is logged.
      console.error('[transactions] a deferred write failed after the commit:', err.message);
    }
  }
}

/**
 * Run `fn` in a transaction, or sequentially when the deployment cannot.
 *
 * `fn(session, defer)` receives the session (null when there is none) and a
 * `defer(task)` registrar for writes that must wait for the commit.
 *
 * @param {(session: import('mongoose').ClientSession | null, defer: (task: () => Promise<any>) => void) => Promise<any>} fn
 * @param {{fallbackOnLimit?: boolean}} [options]
 * @returns {Promise<any>} whatever `fn` resolved to
 */
async function withTransaction(fn, { fallbackOnLimit = false } = {}) {
  const deferred = [];
  const defer = (task) => {
    deferred.push(task);
  };

  // A retried attempt or a fallback after a refused commit must not register
  // the same after-commit work twice.
  const sequential = async () => {
    deferred.length = 0;
    return fn(null, defer);
  };

  let result;
  if (!(await transactionsSupported())) {
    warnFallback();
    result = await sequential();
  } else {
    try {
      await mongoose.connection.transaction(async (session) => {
        deferred.length = 0;
        result = await fn(session, defer);
      });
    } catch (err) {
      if (!fallbackOnLimit || !transactionLimitError(err)) throw err;
      warnLimit(err);
      result = await sequential();
    }
  }

  await runDeferred(deferred);
  return result;
}

/** Forget the cached probe and the one-time warnings. For tests and fixtures. */
function resetTransactionSupport() {
  supported = null;
  warned = false;
  limitWarned = false;
}

module.exports = {
  withTransaction,
  transactionsSupported,
  sessionOptions,
  transactionLimitError,
  resetTransactionSupport,
};
