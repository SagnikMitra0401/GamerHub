const test = require('node:test');
const assert = require('node:assert/strict');

const { csrfProtect, issueCsrfToken, CSRF_HEADER } = require('../utils/csrf');
const { sameSitePolicy } = require('../utils/cookies');

/** Minimal Express request/response for a middleware call. */
function call({ method = 'POST', cookies = {}, header, path = '/users/me/preferences' } = {}) {
  const req = {
    method,
    path,
    cookies,
    get: (name) => (name.toLowerCase() === CSRF_HEADER ? header : undefined),
  };
  const res = {
    statusCode: 0,
    body: null,
    cookies: [],
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
    cookie(name, value) {
      res.cookies.push({ name, value });
      return res;
    },
  };
  let passed = false;
  csrfProtect(req, res, () => {
    passed = true;
  });
  return { res, passed };
}

test('a safe method is never checked', () => {
  const { passed, res } = call({ method: 'GET', cookies: { jwt: 'a' } });
  assert.equal(passed, true);
  assert.equal(res.statusCode, 0);
});

test('a request with no session cookie passes', () => {
  const { passed } = call({ method: 'POST', cookies: {} });
  assert.equal(passed, true);
});

test('a cookie session with the matching header passes', () => {
  const { passed } = call({
    method: 'DELETE',
    cookies: { jwt: 'a', gh_csrf: 'token-value' },
    header: 'token-value',
  });
  assert.equal(passed, true);
});

test('a cookie session without the header is refused', () => {
  const { passed, res } = call({ method: 'PATCH', cookies: { jwt: 'a', gh_csrf: 'token-value' } });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'CSRF_REQUIRED');
});

test('a header that does not match the cookie is refused', () => {
  const { passed, res } = call({
    method: 'POST',
    cookies: { jwt: 'a', gh_csrf: 'token-value' },
    header: 'another-value',
  });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 403);
});

test('a session with no CSRF cookie is refused rather than waved through', () => {
  const { passed, res } = call({
    method: 'POST',
    cookies: { gh_refresh: 'r' },
    header: 'guessed',
  });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 403);
});

test('a refusal hands a session without a CSRF cookie a replacement', () => {
  const first = call({ method: 'PATCH', cookies: { jwt: 'a' } });
  assert.equal(first.res.statusCode, 403);
  const [cookie] = first.res.cookies;
  assert.equal(cookie.name, 'gh_csrf');
  assert.ok(cookie.value, 'no token issued with the refusal');
  assert.equal('csrfToken' in first.res.body, false, 'the cookie is the only copy');
  assert.match(first.res.body.message, /Reload/, 'the refusal does not say what to do');

  const second = call({
    method: 'PATCH',
    cookies: { jwt: 'a', gh_csrf: cookie.value },
    header: cookie.value,
  });
  assert.equal(second.passed, true, 'the replacement token did not work');
});

test('sign-in stays reachable with an expired session cookie', () => {
  const login = call({ method: 'POST', path: '/auth/login', cookies: { jwt: 'stale' } });
  assert.equal(login.passed, true);
  const reset = call({ method: 'POST', path: '/auth/recovery/verify', cookies: { jwt: 'stale' } });
  assert.equal(reset.passed, true);
  const profile = call({ method: 'PATCH', path: '/auth/profile', cookies: { jwt: 'stale' } });
  assert.equal(profile.passed, false, 'a session-scoped path must still be checked');
});

test('the issued cookie is readable by the page and carries the policy', () => {
  const res = {
    cookies: [],
    cookie(name, value, options) {
      res.cookies.push({ name, value, options });
      return res;
    },
  };
  const token = issueCsrfToken(res);
  assert.ok(token.length >= 20);
  const [cookie] = res.cookies;
  assert.equal(cookie.name, 'gh_csrf');
  assert.equal(cookie.value, token);
  assert.equal(cookie.options.httpOnly, false);
  assert.equal(cookie.options.path, '/');
  assert.equal(cookie.options.sameSite, sameSitePolicy());
});

test('the same-site policy follows the deployment, not the build', () => {
  const saved = { env: process.env.NODE_ENV, policy: process.env.COOKIE_SAMESITE };
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.COOKIE_SAMESITE;
    assert.equal(sameSitePolicy(), 'none');
    process.env.COOKIE_SAMESITE = 'lax';
    assert.equal(sameSitePolicy(), 'lax');
    process.env.NODE_ENV = 'development';
    delete process.env.COOKIE_SAMESITE;
    assert.equal(sameSitePolicy(), 'lax');
    process.env.COOKIE_SAMESITE = 'nonsense';
    assert.equal(sameSitePolicy(), 'lax');
  } finally {
    process.env.NODE_ENV = saved.env;
    if (saved.policy === undefined) delete process.env.COOKIE_SAMESITE;
    else process.env.COOKIE_SAMESITE = saved.policy;
  }
});
