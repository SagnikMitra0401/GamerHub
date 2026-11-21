process.env.NODE_ENV = 'test';
process.env.EMAIL_TRANSPORT = 'memory';
process.env.CLIENT_URL = '';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { hashToken, TTL_MS, PURPOSES } = require('../utils/accountTokens');
const { validatePassword, hashPassword, verifyPassword } = require('../utils/passwords');
const {
  sendVerificationEmail,
  sendPasswordResetEmail,
  getOutbox,
  resetOutbox,
  verificationUrl,
  resetUrl
} = require('../utils/email');

const req = {
  get: (name) => (name === 'origin' ? 'https://gamerhub.test' : null),
  protocol: 'https'
};

test('account tokens are stored as a fixed-length digest, never the raw token', () => {
  const raw = 'this-is-a-test-token-with-enough-entropy';
  const hash = hashToken(raw);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hashToken(raw), hash);
  assert.notEqual(hash, raw);
});

test('verification and reset links have different lifetimes', () => {
  assert.equal(PURPOSES.VERIFY_EMAIL, 'verify_email');
  assert.equal(PURPOSES.RESET_PASSWORD, 'reset_password');
  assert.equal(TTL_MS[PURPOSES.VERIFY_EMAIL], 24 * 60 * 60 * 1000);
  assert.equal(TTL_MS[PURPOSES.RESET_PASSWORD], 30 * 60 * 1000);
});

test('password policy rejects short and oversized values', () => {
  assert.equal(validatePassword('short').ok, false);
  assert.equal(validatePassword('x'.repeat(129)).ok, false);
  assert.equal(validatePassword('password123').ok, true);
});

test('password policy rejects values bcrypt would truncate past 72 bytes', () => {
  assert.equal(validatePassword('é'.repeat(37)).ok, false); // 74 UTF-8 bytes
  assert.equal(validatePassword('é'.repeat(36)).ok, true);  // 72 UTF-8 bytes
  assert.equal(validatePassword('😀'.repeat(19)).ok, false); // 76 UTF-8 bytes
});

test('password hashes verify without storing the plaintext', async () => {
  const hash = await hashPassword('password123');
  assert.notEqual(hash, 'password123');
  assert.equal(await verifyPassword('password123', hash), true);
  assert.equal(await verifyPassword('wrong-password', hash), false);
});

test('verification email carries a safe link and escaped display name', async () => {
  resetOutbox();
  const url = verificationUrl(req, 'token with spaces');
  assert.equal(url, 'https://gamerhub.test/verify-email?token=token%20with%20spaces');

  await sendVerificationEmail({ to: 'player@example.com', username: '<script>', url });
  const [mail] = getOutbox();
  assert.equal(mail.to, 'player@example.com');
  assert.equal(mail.subject, 'Confirm your GamerHub email');
  assert.match(mail.text, /expires in 24 hours/);
  assert.match(mail.html, /&lt;script&gt;/);
  assert.doesNotMatch(mail.html, /<script>/);
});

test('reset email uses the 30-minute copy and the reset route', async () => {
  resetOutbox();
  const url = resetUrl(req, 'abc123');
  assert.equal(url, 'https://gamerhub.test/reset-password?token=abc123');

  await sendPasswordResetEmail({ to: 'player@example.com', username: 'player', url });
  const [mail] = getOutbox();
  assert.equal(mail.subject, 'Reset your GamerHub password');
  assert.match(mail.text, /expires in 30 minutes/);
  assert.match(mail.text, /reset-password\?token=abc123/);
});
