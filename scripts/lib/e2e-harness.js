/**
 * Shared scaffolding for the three e2e scripts.
 *
 * Each script used to carry its own copy of `check`, `api` and `register`; the
 * copies had already drifted (one knew about `raw`, one about extra headers,
 * one about extra cookies). The behaviour here is the union, so every script
 * keeps exactly the semantics it had.
 *
 * The base URL is set once after the in-process server starts listening:
 *   setBase(`http://127.0.0.1:${server.address().port}`)
 */
const assert = require('assert/strict');
const { io: ioClient } = require('../../client/node_modules/socket.io-client');

let base = '';

function setBase(url) {
  base = url;
  return base;
}

const results = [];

/** Run one assertion, print one line, and abort the suite on failure. */
const check = (name, fn) => {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`  ✔ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
    console.log(`  ✖ ${name}\n    ${err.message}`);
    throw err;
  }
};

/**
 * One HTTP call. Returns the parsed body plus the cookies the response set, so
 * callers can act as a signed-in user without a cookie jar.
 */
const api = async (path, { method = 'GET', body, cookie, token, origin, headers: extra, raw } = {}) => {
  const headers = { ...(extra || {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  });

  const setCookie = res.headers.getSetCookie?.() || [];
  const cookieHeader = setCookie.map((c) => c.split(';')[0]).join('; ');
  if (raw) return { status: res.status, text: await res.text(), headers: res.headers };

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data, cookie: cookieHeader, setCookie, headers: res.headers };
};

/** Resolve with the first matching socket payload, or null on timeout. */
const waitFor = (socket, event, predicate = () => true, timeoutMs = 5000) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, timeoutMs);
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });

const connectSocket = (token) =>
  new Promise((resolve, reject) => {
    const socket = ioClient(base, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket connect timeout')), 8000);
  });

/**
 * Register a throwaway account and return everything a suite needs to act as
 * it. `probeId` re-reads the id from `/auth/me`, which is also a cheap check
 * that the cookie alone resolves the session.
 */
const registerUser = async (username, { probeId = false } = {}) => {
  const res = await api('/api/auth/register', {
    method: 'POST',
    body: { username, email: `${username}@example.com`, password: 'password123' }
  });
  assert.equal(res.status, 201, `register ${username}: ${JSON.stringify(res.data)}`);

  const user = {
    username,
    cookie: res.cookie,
    token: res.data.token,
    id: res.data.user?.id || res.data.user?._id
  };

  if (probeId) {
    const me = await api('/api/auth/me', { cookie: res.cookie });
    user.id = me.data.user._id;
  }

  return user;
};

/** Print the tally and hand back the failures so the caller owns the exit code. */
function report() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  return failed;
}

module.exports = {
  setBase,
  api,
  check,
  results,
  report,
  waitFor,
  connectSocket,
  registerUser
};
