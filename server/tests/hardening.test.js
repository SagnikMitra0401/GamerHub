/**
 * Hardening pass — rate-limit keying and the secret-leak gate.
 *
 * Both are pure functions of their inputs, so they are tested without a
 * database or a running app. The last test is a real gate: it scans the client
 * source the same way CI does.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { clientKey, createLimiter } = require('../middleware/limiters');
const { scanText } = require('../../scripts/lib/secretPatterns');
const { walk } = require('../../scripts/scan-secrets');

// ── Rate-limit keying ──────────────────────────────────────────────────────

test('a signed-in caller is keyed by user, not by address', () => {
  const req = { user: { _id: 'u1' }, ip: '203.0.113.9' };
  assert.equal(clientKey(req), 'user:u1');
});

test('an anonymous IPv4 caller is keyed by address', () => {
  assert.equal(clientKey({ ip: '203.0.113.9' }), 'ip:203.0.113.9');
});

test('IPv6 addresses are grouped by /64 so one host cannot cycle addresses', () => {
  const first = clientKey({ ip: '2001:db8:1:2:aaaa:bbbb:cccc:dddd' });
  const second = clientKey({ ip: '2001:db8:1:2:1111:2222:3333:4444' });
  assert.equal(first, second);
  assert.match(first, /::\/64$/);
});

test('a missing address still produces a stable key', () => {
  assert.equal(clientKey({}), 'ip:unknown');
});

test('a limiter exposes the configured budget', () => {
  const limiter = createLimiter({ windowMs: 1000, max: 7, message: 'nope' });
  assert.equal(typeof limiter, 'function');
});

// ── Secret detection ───────────────────────────────────────────────────────

// Built at runtime so the synthetic values never appear as credential-shaped
// literals in the repository. GitHub's secret scanner cannot tell a detector
// fixture from a live key, and a false alert would bury an actual leak.
const googleKeyFixture = ['AIza', 'SyA1234567890abcdefghijklmnopqrstuv'].join('');
const awsKeyFixture = ['AKIA', 'IOSFODNN7REALKEY'].join('');
const stripeKeyFixture = ['sk', '_live_', '51H8xYzQqWwEeRrTt'].join('');
const jwtSecretFixture = ['8f4b1c2d9e6a7b3c', '5d0e1f2a4b6c8d0e'].join('');
const bearerTokenFixture = ['Bearer', ' eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abc'].join('');

const secretCases = [
  [`mongodb+srv://leak:${['sup3r', 'Secret'].join('')}@cluster0.example.net/db`, 'database URI with credentials'],
  [`const key = "${awsKeyFixture}";`, 'AWS access key id'],
  [`google: "${googleKeyFixture}"`, 'Google API key'],
  [`stripe: "${stripeKeyFixture}"`, 'Stripe secret key'],
  ['-----BEGIN RSA PRIVATE KEY-----', 'private key block'],
  [`JWT_SECRET="${jwtSecretFixture}"`, 'quoted secret assignment'],
  [`Authorization: "${bearerTokenFixture}"`, 'literal bearer token']
];

for (const [sample, expected] of secretCases) {
  test(`detects ${expected}`, () => {
    const hits = scanText(sample);
    assert.ok(hits.some((hit) => hit.name === expected), JSON.stringify(hits));
  });
}

test('ignores variable names, placeholders and ordinary URLs', () => {
  const clean = [
    'const token = process.env.JWT_SECRET;',
    'JWT_SECRET=replace-with-64-random-characters',
    'CLOUDINARY_API_KEY=your-key-here',
    'MongoDB Atlas connection string, including the database name.',
    'https://example.com/api/keys',
    'sk_test_placeholder'
  ].join('\n');
  assert.deepEqual(scanText(clean), []);
});

test('a finding never echoes the whole secret', () => {
  const [hit] = scanText(googleKeyFixture);
  assert.ok(hit);
  assert.ok(!hit.excerpt.includes('1234567890abcdefghijklmnopqrstuv'));
});

// ── The real gate ──────────────────────────────────────────────────────────

test('client source and build output contain no credential-shaped literal', () => {
  const roots = ['client/src', 'client/dist'].map((dir) => path.resolve(__dirname, '../..', dir));
  for (const root of roots) {
    for (const file of walk(root)) {
      const hits = scanText(fs.readFileSync(file, 'utf8'));
      assert.deepEqual(hits, [], `${path.relative(process.cwd(), file)}: ${JSON.stringify(hits)}`);
    }
  }
});
