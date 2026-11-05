/**
 * Phase 10 end-to-end verification — load safety and visibility privacy.
 *
 * Runs against a THROWAWAY database on the same cluster:
 *   node scripts/e2e-phase10.js
 *
 * The checks here cannot be proven by pure functions: they need the real
 * limiter store, the real socket handshake and the real population of a page.
 * Budgets are lowered through env so the suite exercises the refusal path in a
 * few requests instead of hundreds.
 */
require('dotenv').config();
const http = require('http');
const assert = require('assert/strict');
const mongoose = require('mongoose');

const E2E_DB = `gamerhub_e2e10_${Date.now().toString(36)}`;

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
process.env.SEARCH_RATE_LIMIT_MAX = '8';
process.env.SOCKET_JOIN_RATE_MAX = '5';
process.env.SOCKET_MAX_PER_USER = '2';
process.env.DISABLE_RETENTION_WORKER = '1';

const connectDB = require('../server/config/db');
const app = require('../server/app');
const { initSocket } = require('../server/config/socket');
const { closeDomainConnections } = require('../server/config/connections');

const { api, check, connectSocket, registerUser, report, setBase, waitFor } = require('./lib/e2e-harness');

async function scenarios({ alice, bob, carol, dave, sockets }) {
  const post = await api('/api/posts', {
    method: 'POST',
    cookie: alice.cookie,
    body: {
      title: 'Hardening probe',
      content: 'The hardeningvisibilitytoken appears in this post.',
      tags: ['valorant']
    }
  });
  check('the visibility probe post is created', () => assert.equal(post.status, 201, JSON.stringify(post.data)));

  const beforeFreeze = await api('/api/users/search?q=hardeningvisibilitytoken', { cookie: bob.cookie });
  check('a search finds the post before the author is frozen', () => {
    assert.equal(beforeFreeze.status, 200, JSON.stringify(beforeFreeze.data));
    assert.ok(
      beforeFreeze.data.posts.some((entry) => String(entry._id) === String(post.data._id)),
      JSON.stringify(beforeFreeze.data.posts)
    );
  });

  const freeze = await api('/api/account/freeze', {
    method: 'POST',
    cookie: alice.cookie,
    body: { frozen: true, password: 'password123' }
  });
  check('the author can freeze with the password', () => {
    assert.equal(freeze.status, 200, JSON.stringify(freeze.data));
    assert.equal(freeze.data.status, 'frozen');
  });

  const whileFrozen = await api('/api/users/search?q=hardeningvisibilitytoken', { cookie: bob.cookie });
  check('a frozen author leaves search on the very next request (visibility cache invalidated)', () => {
    assert.equal(whileFrozen.status, 200, JSON.stringify(whileFrozen.data));
    assert.equal(
      whileFrozen.data.posts.some((entry) => String(entry._id) === String(post.data._id)),
      false
    );
  });

  await api('/api/account/freeze', {
    method: 'POST',
    cookie: alice.cookie,
    body: { frozen: false, password: 'password123' }
  });

  const afterUnfreeze = await api('/api/users/search?q=hardeningvisibilitytoken', { cookie: bob.cookie });
  check('unfreezing puts the post back in search', () => {
    assert.ok(
      afterUnfreeze.data.posts.some((entry) => String(entry._id) === String(post.data._id)),
      JSON.stringify(afterUnfreeze.data.posts)
    );
  });

  const presence = await api('/api/users/presence', {
    method: 'PATCH',
    cookie: alice.cookie,
    body: { status: 'invisible' }
  });
  check('the leader can go invisible', () => assert.equal(presence.status, 200, JSON.stringify(presence.data)));

  const party = await api('/api/lfg', {
    method: 'POST',
    cookie: alice.cookie,
    body: { gameTitle: 'Hardening Test Game', activity: 'Ranked', maxSlots: 4 }
  });
  check('the invisible leader can create a squad', () => assert.equal(party.status, 201, JSON.stringify(party.data)));

  const board = await api('/api/lfg', { cookie: bob.cookie });
  check('the squad board projects an invisible leader as offline', () => {
    const entry = (board.data.items || []).find((item) => String(item._id) === String(party.data._id));
    assert.ok(entry, 'squad missing from the board');
    assert.equal(entry.leader.presence.status, 'offline');
    assert.equal(entry.leader.presence.activeGame, '');
  });

  check('the squad board does not expose the leader account status', () => {
    const entry = (board.data.items || []).find((item) => String(item._id) === String(party.data._id));
    assert.equal(entry.leader.status, undefined);
  });

  // ── Search budget ────────────────────────────────────────────────────────
  let lastSearch = null;
  for (let index = 0; index < 9; index += 1) {
    lastSearch = await api('/api/users/search?q=hardening', { cookie: dave.cookie });
  }
  check('search is rate-limited per account', () => {
    assert.equal(lastSearch.status, 429, `expected 429, got ${lastSearch.status}`);
    assert.match(String(lastSearch.data?.message || ''), /search/i);
  });

  // A different account still has its own budget; the limit is not global.
  const otherCaller = await api('/api/users/search?q=hardening', { cookie: bob.cookie });
  check('one account exhausting the budget does not block another', () => {
    assert.equal(otherCaller.status, 200, JSON.stringify(otherCaller.data));
  });

  // ── Socket budgets ───────────────────────────────────────────────────────
  const socket = sockets.carol;
  const limited = waitFor(socket, 'error_msg', (payload) => payload?.code === 'RATE_LIMITED', 6000);
  for (let index = 0; index < 8; index += 1) {
    socket.emit('join_channel', { channelId: '507f1f77bcf86cd799439011' });
  }
  const refusal = await limited;
  check('channel joins are rate-limited per account', () => {
    assert.ok(refusal, 'no RATE_LIMITED event arrived');
  });

  const second = await connectSocket(carol.token);
  let thirdError = null;
  try {
    const third = await connectSocket(carol.token);
    third.close();
  } catch (err) {
    thirdError = err;
  }
  check('a third live socket for one account is refused', () => {
    assert.match(String(thirdError?.message || ''), /TOO_MANY_CONNECTIONS/);
  });

  second.close();
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function run() {
  await connectDB();
  console.log(`Using throwaway database: ${E2E_DB}`);

  const server = http.createServer(app);
  initSocket(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  setBase(`http://127.0.0.1:${server.address().port}`);

  const alice = await registerUser('hard10alice', { probeId: true });
  const bob = await registerUser('hard10bob', { probeId: true });
  const carol = await registerUser('hard10carol', { probeId: true });
  const dave = await registerUser('hard10dave', { probeId: true });

  const sockets = {
    carol: await connectSocket(carol.token)
  };

  try {
    await scenarios({ alice, bob, carol, dave, sockets });
  } finally {
    for (const socket of Object.values(sockets)) socket.disconnect();
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
