/**
 * Hardcoded-origin gate contract.
 *
 * The gate is a lint over text, so its rules are checked on source snippets
 * rather than on files. The point of these checks is the boundary: an origin
 * allow-list is refused, an unrelated constant that happens to start with
 * ALLOW is not.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { scanSource } = require('../../scripts/scan-hosts');

const reasons = (source) => scanSource(source).map((finding) => finding.reason);

test('a literal origin array is refused', () => {
  assert.deepEqual(reasons("const ALLOWED_ORIGINS = ['https://gamerhub.app'];"), [
    'literal origin allow-list'
  ]);
});

test('a multi-line origin array is refused', () => {
  const source = ['const EXTRA_ORIGIN = [', "  'https://gamerhub.app'", '];'].join('\n');
  assert.deepEqual(reasons(source), ['literal origin allow-list']);
});

test('an allow-list constant is refused', () => {
  assert.deepEqual(reasons("const ALLOWLIST = ['https://gamerhub.app'];"), [
    'literal origin allow-list'
  ]);
  assert.deepEqual(reasons("const ALLOW_LIST = ['https://gamerhub.app'];"), [
    'literal origin allow-list'
  ]);
  assert.deepEqual(reasons("const ALLOWED_HOSTS = ['gamerhub.app'];"), [
    'literal origin allow-list'
  ]);
});

test('an unrelated ALLOW constant is left alone', () => {
  assert.deepEqual(reasons("const ALLOWED_METHODS = ['GET', 'POST'];"), []);
  assert.deepEqual(reasons("const ALLOWED_TYPES = ['image/png'];"), []);
  assert.deepEqual(reasons("const ALLOWED_MIME_LIST = ['image/png'];"), []);
});

test('a non-array origin constant is left alone', () => {
  assert.deepEqual(reasons("const ALLOWED_ORIGIN = 'https://gamerhub.app';"), []);
  assert.deepEqual(reasons('const allowedOrigins = getOrigins();'), []);
});

test('a shared hosting domain is refused wherever it appears', () => {
  assert.deepEqual(reasons("const preview = 'https://gamerhub-git-main.vercel.app';"), [
    'shared hosting domain'
  ]);
});

test('a third-party API URL is left alone', () => {
  assert.deepEqual(reasons("const API = 'https://api.igdb.com/v4/games';"), []);
  assert.deepEqual(reasons("const CDN = 'https://res.cloudinary.com/demo/image/upload';"), []);
});
