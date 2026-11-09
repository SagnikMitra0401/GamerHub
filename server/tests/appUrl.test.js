const test = require('node:test');
const assert = require('node:assert/strict');

const { publicBaseUrl } = require('../utils/appUrl');
const { resetOriginCache } = require('../utils/origins');

function withEnv(env, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetOriginCache();
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetOriginCache();
  }
}

const fakeRequest = ({ origin, host = 'localhost:5000', protocol = 'http' } = {}) => ({
  protocol,
  get: (name) => (name === 'origin' ? origin : name === 'host' ? host : undefined)
});

test('a hosted deployment links to its declared public origin, never localhost', () => {
  withEnv({ CLIENT_URL: 'https://gamerhub.app', EXTRA_ALLOWED_ORIGINS: '' }, () => {
    assert.equal(
      publicBaseUrl(fakeRequest({ origin: 'http://localhost:3000' })),
      'https://gamerhub.app'
    );
  });
});

test('local development links use the vite origin, not the API host', () => {
  withEnv({ CLIENT_URL: 'http://localhost:3000', EXTRA_ALLOWED_ORIGINS: '' }, () => {
    assert.equal(
      publicBaseUrl(fakeRequest({ origin: 'http://localhost:3000' })),
      'http://localhost:3000'
    );
    // Non-browser callers (scripts) still get the client origin.
    assert.equal(publicBaseUrl(fakeRequest({})), 'http://localhost:3000');
  });
});

test('the first non-loopback entry wins when CLIENT_URL is a list', () => {
  withEnv({ CLIENT_URL: 'http://localhost:3000, https://gamerhub.app/', EXTRA_ALLOWED_ORIGINS: '' }, () => {
    assert.equal(publicBaseUrl(fakeRequest({})), 'https://gamerhub.app');
  });
});

test('with no configuration at all the request host is the last resort', () => {
  withEnv({ CLIENT_URL: undefined, EXTRA_ALLOWED_ORIGINS: '' }, () => {
    assert.equal(
      publicBaseUrl(fakeRequest({ host: 'gaminghub.example', protocol: 'https' })),
      'https://gaminghub.example'
    );
  });
});
