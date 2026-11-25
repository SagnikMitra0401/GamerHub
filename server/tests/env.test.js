/**
 * Boot configuration contract.
 *
 * The validator is a pure function of an environment object, so every rule can
 * be checked without touching the real process environment or a database. The
 * last test spawns a child to prove `loadEnv` exits 1 and names the keys.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const { validateEnv, MIN_JWT_SECRET_LENGTH } = require('../config/env');

const ROOT = path.resolve(__dirname, '../..');

const validEnv = (overrides = {}) => ({
  NODE_ENV: 'development',
  MONGO_URI: 'mongodb+srv://user:password@cluster.example.net/gamerhub',
  JWT_SECRET: 'a'.repeat(64),
  CLIENT_URL: 'http://localhost:3000',
  ...overrides,
});

const errorsOf = (env) => validateEnv(env).errors.join('\n');

test('a complete development environment passes', () => {
  const report = validateEnv(validEnv());
  assert.deepEqual(report.errors, []);
});

test('a missing JWT_SECRET is named', () => {
  assert.match(errorsOf(validEnv({ JWT_SECRET: '' })), /JWT_SECRET is not set/);
});

test('a short JWT_SECRET reports the minimum and never the value', () => {
  const text = errorsOf(validEnv({ JWT_SECRET: 'short-secret' }));
  assert.match(text, new RegExp(`at least ${MIN_JWT_SECRET_LENGTH}`));
  assert.ok(!text.includes('short-secret'), text);
});

test('the example placeholder is refused even though it is long enough', () => {
  assert.match(
    errorsOf(validEnv({ JWT_SECRET: 'replace-with-64-random-characters' })),
    /placeholder/,
  );
});

test('a missing MONGO_URI is named', () => {
  const { MONGO_URI, ...rest } = validEnv();
  assert.match(errorsOf(rest), /MONGO_URI is not set/);
});

test('a non-Mongo connection string is refused', () => {
  assert.match(errorsOf(validEnv({ MONGO_URI: 'postgres://host/db' })), /must start with mongodb/);
});

test('production refuses to boot without CLIENT_URL', () => {
  const { CLIENT_URL, ...rest } = validEnv({ NODE_ENV: 'production' });
  assert.match(errorsOf(rest), /CLIENT_URL is not set/);
});

test('a wildcard origin is refused', () => {
  assert.match(errorsOf(validEnv({ CLIENT_URL: 'https://*.example.net' })), /wildcard/);
});

test('an origin with a path is refused', () => {
  assert.match(errorsOf(validEnv({ CLIENT_URL: 'https://gamerhub.example/app' })), /path/);
});

test('production refuses a plain-http origin', () => {
  const env = validEnv({
    NODE_ENV: 'production',
    CLIENT_URL: 'http://gamerhub.example',
    EMAIL_CODE_PEPPER: 'p'.repeat(32),
  });
  assert.match(errorsOf(env), /CLIENT_URL\[1\] must use https in production/);
});

test('production refuses a plain-http extra origin even with an https client url', () => {
  const env = validEnv({
    NODE_ENV: 'production',
    CLIENT_URL: 'https://gamerhub.example',
    EXTRA_ALLOWED_ORIGINS: 'https://preview.gamerhub.example, http://old.gamerhub.example',
    EMAIL_CODE_PEPPER: 'p'.repeat(32),
  });
  const text = errorsOf(env);
  assert.match(text, /EXTRA_ALLOWED_ORIGINS\[2\] must use https in production/);
  assert.doesNotMatch(text, /EXTRA_ALLOWED_ORIGINS\[1\]/);
});

test('development accepts an http origin', () => {
  assert.deepEqual(validateEnv(validEnv({ CLIENT_URL: 'http://localhost:3000' })).errors, []);
});

test('a non-http scheme is refused in every environment', () => {
  const text = errorsOf(validEnv({ CLIENT_URL: 'ftp://gamerhub.example' }));
  assert.match(text, /must use http or https/);
});

test('a second entry in the origin list is reported by position', () => {
  const text = errorsOf(validEnv({ EXTRA_ALLOWED_ORIGINS: 'https://a.example, not-a-url' }));
  assert.match(text, /EXTRA_ALLOWED_ORIGINS\[2\] is not an absolute URL/);
});

test('a misspelled NODE_ENV is refused', () => {
  assert.match(errorsOf(validEnv({ NODE_ENV: 'prod' })), /NODE_ENV is "prod"/);
});

test('production requires an email code pepper', () => {
  const env = validEnv({ NODE_ENV: 'production', CLIENT_URL: 'https://gamerhub.example' });
  assert.match(errorsOf(env), /EMAIL_CODE_PEPPER is not set/);
});

test('a malformed proxy hop count is refused', () => {
  assert.match(errorsOf(validEnv({ TRUST_PROXY: 'one' })), /TRUST_PROXY must be a whole number/);
});

test('a partly configured optional integration warns without blocking', () => {
  const report = validateEnv(validEnv({ CLOUDINARY_CLOUD_NAME: 'demo-cloud' }));
  assert.deepEqual(report.errors, []);
  assert.match(report.warnings.join('\n'), /Cloudinary is partly configured/);
});

test('loadEnv exits 1 and names every missing required key', () => {
  const result = spawnSync(process.execPath, ['-e', "require('./server/config/env').loadEnv({})"], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /JWT_SECRET is not set/);
  assert.match(result.stderr, /MONGO_URI is not set/);
  assert.match(result.stdout, /^$/);
});
