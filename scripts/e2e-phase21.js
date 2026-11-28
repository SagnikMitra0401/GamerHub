/**
 * Phase 19 end-to-end verification — session lifetime.
 *
 * Runs against a THROWAWAY database on the same cluster:
 *   node scripts/e2e-phase21.js
 *
 * A refresh token is a credential, so its properties can only be checked over
 * HTTP with real cookies: rotation, a replay that must sign the account out,
 * the idle window, and the two sign-out routes. The expired-access check waits
 * for a real one-second token to expire rather than mocking the clock.
 */
require('dotenv').config();
const assert = require('assert/strict');
const http = require('http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const E2E_DB = `gamerhub_e2e21_${Date.now().toString(36)}`;

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
process.env.REFRESH_RATE_LIMIT_MAX = '1000';
process.env.DISABLE_RETENTION_WORKER = '1';

const connectDB = require('../server/config/db');
const app = require('../server/app');
const { initSocket } = require('../server/config/socket');
const { closeDomainConnections } = require('../server/config/connections');
const SessionToken = require('../server/models/SessionToken');
const { api, check, registerUser, report, setBase } = require('./lib/e2e-harness');

const DAY_MS = 24 * 60 * 60 * 1000;

/** The `name=value` pair for one cookie in a request's cookie header. */
const pair = (cookieHeader, name) =>
  String(cookieHeader || '')
    .split('; ')
    .find((entry) => entry.startsWith(`${name}=`)) || '';

/** A cookie header carrying specific tokens plus the CSRF cookie. */
const withCsrf = (res, ...tokens) =>
  [...tokens, pair(res.cookie, 'gh_csrf')].filter(Boolean).join('; ');

const login = (username) =>
  api('/api/auth/login', {
    method: 'POST',
    body: { email: `${username}@example.com`, password: 'password123' },
  });

async function sessionScenarios() {
  // ---- Both cookies, and the access cookie resolves the session ------------
  const account = await registerUser('sess21rotate');
  check('a new session sets an access cookie and a refresh cookie', () => {
    assert.ok(pair(account.cookie, 'jwt'), 'no access cookie');
    assert.ok(pair(account.cookie, 'gh_refresh'), 'no refresh cookie');
  });

  const csrfCookie = pair(account.cookie, 'gh_csrf');
  const csrfValue = csrfCookie.split('=').slice(1).join('=');
  check('a session sets the CSRF cookie the page has to echo', () => {
    assert.ok(csrfValue, 'no CSRF cookie on the session');
  });

  const me = await api('/api/auth/me', { cookie: account.cookie });
  check('the access cookie resolves the session', () => assert.equal(me.status, 200));

  // ---- CSRF -----------------------------------------------------------------
  const forged = await api('/api/auth/profile', {
    method: 'PATCH',
    cookie: account.cookie,
    body: { bio: 'session check' },
    csrf: false,
  });
  const verified = await api('/api/auth/profile', {
    method: 'PATCH',
    cookie: account.cookie,
    body: { bio: 'session check' },
    headers: { 'x-csrf-token': csrfValue },
  });
  check('a mutation without the CSRF header is refused, with the header accepted', () => {
    assert.equal(forged.status, 403);
    assert.equal(forged.data.code, 'CSRF_REQUIRED');
    assert.equal(verified.status, 200, JSON.stringify(verified.data));
  });

  // ---- A session that started before the CSRF cookie existed --------------
  // The browser signed in last week holds the session cookies and nothing else.
  const strandedJar = [pair(account.cookie, 'jwt'), pair(account.cookie, 'gh_refresh')]
    .filter(Boolean)
    .join('; ');
  const stranded = await api('/api/auth/profile', {
    method: 'PATCH',
    cookie: strandedJar,
    body: { bio: 'pre-deploy session' },
    csrf: false,
  });
  const replacement = pair(stranded.cookie, 'gh_csrf');
  const healed = await api('/api/auth/profile', {
    method: 'PATCH',
    cookie: `${strandedJar}; ${replacement}`,
    body: { bio: 'pre-deploy session' },
  });
  check('a session with no CSRF cookie is refused with a replacement it can use', () => {
    assert.equal(stranded.status, 403);
    assert.equal(stranded.data.code, 'CSRF_REQUIRED');
    assert.match(stranded.data.message, /Reload/, 'the refusal does not say what to do');
    assert.ok(replacement, 'the refusal set no CSRF cookie');
    assert.equal(healed.status, 200, JSON.stringify(healed.data));
  });

  // ---- Rotation ------------------------------------------------------------
  const firstRefresh = pair(account.cookie, 'gh_refresh');
  const rotated = await api('/api/auth/refresh', {
    method: 'POST',
    cookie: withCsrf(account, firstRefresh),
  });
  const secondRefresh = pair(rotated.cookie, 'gh_refresh');
  check('a refresh returns a new access token and a new refresh token', () => {
    assert.equal(rotated.status, 200);
    assert.ok(rotated.data.token, 'no access token in the response');
    assert.ok(secondRefresh, 'no rotated refresh cookie');
    assert.notEqual(secondRefresh, firstRefresh);
  });

  const afterRotate = await api('/api/auth/me', { cookie: pair(rotated.cookie, 'jwt') });
  check('the rotated access token works', () => assert.equal(afterRotate.status, 200));

  // ---- A replayed refresh token signs the account out ----------------------
  const replay = await api('/api/auth/refresh', {
    method: 'POST',
    cookie: withCsrf(account, firstRefresh),
  });
  const openAfterReplay = await SessionToken.countDocuments({
    userId: account.id,
    revokedAt: null,
  });
  check('a replayed refresh token is refused and revokes every session', () => {
    assert.equal(replay.status, 401);
    assert.equal(replay.data.code, 'REFRESH_REPLAYED');
    assert.equal(openAfterReplay, 0, 'a session survived the replay');
  });

  const afterReplay = await api('/api/auth/refresh', {
    method: 'POST',
    cookie: withCsrf(rotated, secondRefresh),
  });
  check('the rotated token dies with the replay', () => {
    assert.equal(afterReplay.status, 401);
  });

  // ---- An expired access token is repairable, not fatal --------------------
  const expiring = await login('sess21rotate');
  const expiredAccess = jwt.sign(
    { userId: expiring.data.user.id, sv: 0, typ: 'access' },
    process.env.JWT_SECRET,
    { expiresIn: '1s' },
  );
  const expiringRefresh = pair(expiring.cookie, 'gh_refresh');
  assert.ok(expiringRefresh, 'the login response carried no refresh cookie');

  await new Promise((resolve) => setTimeout(resolve, 1200));
  const expiredCall = await api('/api/auth/me', {
    cookie: `jwt=${expiredAccess}; ${expiringRefresh}`,
  });
  check('an expired access token answers 401 TOKEN_EXPIRED', () => {
    assert.equal(expiredCall.status, 401);
    assert.equal(expiredCall.data.code, 'TOKEN_EXPIRED');
  });

  const recovered = await api('/api/auth/refresh', {
    method: 'POST',
    cookie: withCsrf(expiring, expiringRefresh),
  });
  const recoveredCall = await api('/api/auth/me', { cookie: pair(recovered.cookie, 'jwt') });
  check('the refresh token recovers the session without a password', () => {
    assert.equal(recovered.status, 200);
    assert.ok(pair(recovered.cookie, 'jwt'), 'no access cookie after refresh');
    assert.equal(recoveredCall.status, 200);
  });

  // ---- Idle expiry ---------------------------------------------------------
  const idler = await login('sess21rotate');
  const idlerRefresh = pair(idler.cookie, 'gh_refresh');
  const idlerRecord = await SessionToken.findOne({
    userId: idler.data.user.id,
    revokedAt: null,
  }).sort({ createdAt: -1 });
  assert.ok(idlerRecord, 'no live session record for the idle check');
  await SessionToken.updateOne(
    { _id: idlerRecord._id },
    { $set: { lastUsedAt: new Date(Date.now() - 20 * DAY_MS) } },
  );

  const idle = await api('/api/auth/refresh', {
    method: 'POST',
    cookie: withCsrf(idler, idlerRefresh),
  });
  const idleAfter = await SessionToken.findById(idlerRecord._id).select('revokedAt').lean();
  check('a refresh after 14 days of inactivity is refused and revoked', () => {
    assert.equal(idle.status, 401);
    assert.equal(idle.data.code, 'SESSION_IDLE');
    assert.ok(idleAfter.revokedAt, 'the idle session was not revoked');
  });

  // ---- Sign out ------------------------------------------------------------
  const leaver = await login('sess21rotate');
  const leaverRefresh = pair(leaver.cookie, 'gh_refresh');
  const signedOut = await api('/api/auth/logout', {
    method: 'POST',
    cookie: withCsrf(leaver, pair(leaver.cookie, 'jwt'), leaverRefresh),
  });
  const refreshAfterLogout = await api('/api/auth/refresh', {
    method: 'POST',
    cookie: withCsrf(leaver, leaverRefresh),
  });
  // A cleared cookie is still a Set-Cookie header, with an empty value.
  const cleared = (header, name) => ['', `${name}=`].includes(pair(header, name));
  check('signing out revokes this session and clears both cookies', () => {
    assert.equal(signedOut.status, 200);
    assert.equal(cleared(signedOut.cookie, 'jwt'), true, 'the access cookie was not cleared');
    assert.equal(
      cleared(signedOut.cookie, 'gh_refresh'),
      true,
      'the refresh cookie was not cleared',
    );
    assert.equal(refreshAfterLogout.status, 401);
  });

  // ---- Sign out everywhere -------------------------------------------------
  const deviceA = await login('sess21rotate');
  const deviceB = await login('sess21rotate');
  const everywhere = await api('/api/auth/logout-all', {
    method: 'POST',
    cookie: withCsrf(deviceA, pair(deviceA.cookie, 'jwt'), pair(deviceA.cookie, 'gh_refresh')),
  });
  const remaining = await SessionToken.countDocuments({
    userId: deviceA.data.user.id,
    revokedAt: null,
  });
  const otherDeviceRefresh = await api('/api/auth/refresh', {
    method: 'POST',
    cookie: withCsrf(deviceB, pair(deviceB.cookie, 'gh_refresh')),
  });
  const otherDeviceAccess = await api('/api/auth/me', {
    cookie: pair(deviceB.cookie, 'jwt'),
  });
  check('sign out everywhere retires every refresh record and access token', () => {
    assert.equal(everywhere.status, 200, JSON.stringify(everywhere.data));
    assert.equal(remaining, 0, 'a refresh record survived sign out everywhere');
    assert.equal(otherDeviceRefresh.status, 401);
    assert.equal(otherDeviceAccess.status, 401);
  });
}

async function run() {
  await connectDB();
  console.log(`Using throwaway database: ${E2E_DB}`);

  // A fresh database builds indexes on first write; the refresh row is looked
  // up by a unique hash, so let the build finish before the first registration.
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));

  const server = http.createServer(app);
  initSocket(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  setBase(`http://127.0.0.1:${server.address().port}`);

  try {
    await sessionScenarios();
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
