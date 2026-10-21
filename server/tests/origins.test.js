const test = require('node:test');
const assert = require('node:assert/strict');

const { isAllowedOrigin, resetOriginCache } = require('../utils/origins');

const withEnv = (env, fn) => {
  const previous = { ...process.env };
  Object.assign(process.env, env);
  resetOriginCache();
  try {
    fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
    resetOriginCache();
  }
};

test('production allows only exact configured origins', () => {
  withEnv({ NODE_ENV: 'production', CLIENT_URL: 'https://gamerhub.app', EXTRA_ALLOWED_ORIGINS: '' }, () => {
    assert.equal(isAllowedOrigin('https://gamerhub.app'), true);
    assert.equal(isAllowedOrigin('https://gamerhub.app/'), true); // trailing slash tolerated
    assert.equal(isAllowedOrigin('https://evil.vercel.app'), false); // wildcard removed
    assert.equal(isAllowedOrigin('https://gamerhub.app.evil.com'), false);
    assert.equal(isAllowedOrigin('http://localhost:3000'), false); // loopback not allowed in prod
    assert.equal(isAllowedOrigin(undefined), true); // non-browser client
  });
});

test('a comma-separated allow-list is supported', () => {
  withEnv({
    NODE_ENV: 'production',
    CLIENT_URL: 'https://gamerhub.app, https://www.gamerhub.app',
    EXTRA_ALLOWED_ORIGINS: 'https://gamerhub-git-preview.vercel.app'
  }, () => {
    assert.equal(isAllowedOrigin('https://www.gamerhub.app'), true);
    assert.equal(isAllowedOrigin('https://gamerhub-git-preview.vercel.app'), true);
    assert.equal(isAllowedOrigin('https://some-other-preview.vercel.app'), false);
  });
});

test('development allows loopback origins on any port', () => {
  withEnv({ NODE_ENV: 'development', CLIENT_URL: 'http://localhost:3000', EXTRA_ALLOWED_ORIGINS: '' }, () => {
    assert.equal(isAllowedOrigin('http://localhost:5173'), true);
    assert.equal(isAllowedOrigin('http://127.0.0.1:4173'), true);
    assert.equal(isAllowedOrigin('https://evil.example.com'), false);
  });
});
