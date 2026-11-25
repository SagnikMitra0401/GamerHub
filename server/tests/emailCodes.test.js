process.env.NODE_ENV = 'test';
process.env.EMAIL_TRANSPORT = 'memory';
process.env.EMAIL_CODE_PEPPER = 'unit-test-pepper';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  PURPOSES,
  TTL_MS,
  MAX_ATTEMPTS,
  CODE_LENGTH,
  generateCode,
  isCode,
  hashCode,
} = require('../utils/emailCodes');
const {
  sendVerificationCodeEmail,
  sendRecoverySetupCodeEmail,
  sendAccountRecoveryCodeEmail,
  sendRecoveryEmailChangedEmail,
  sendAccountRecoveryCompletedEmail,
  redactSecrets,
  getOutbox,
  resetOutbox,
} = require('../utils/email');

test('codes are eight digits, zero-padded, and not sequential', () => {
  assert.equal(CODE_LENGTH, 8);
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const code = generateCode();
    assert.match(code, /^\d{8}$/);
    assert.equal(code.length, 8);
    seen.add(code);
  }
  // A 200-draw sample colliding would mean the generator is not random enough.
  assert.ok(seen.size > 190, `only ${seen.size} distinct codes in 200 draws`);
});

test('only an eight-digit string is treated as a code', () => {
  assert.equal(isCode('12345678'), true);
  assert.equal(isCode('00000000'), true);
  assert.equal(isCode('1234567'), false);
  assert.equal(isCode('123456789'), false);
  assert.equal(isCode('1234 5678'), false);
  assert.equal(isCode('abcdefgh'), false);
  assert.equal(isCode(12345678), false);
  assert.equal(isCode(undefined), false);
});

test('the stored hash is keyed, stable and purpose-bound', () => {
  const code = '48291573';
  const user = '64b7f9c2e4b0a1d2c3e4f506';
  const hash = hashCode(user, PURPOSES.VERIFY_EMAIL, code);

  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, hashCode(user, PURPOSES.VERIFY_EMAIL, code));
  assert.notEqual(hash, code);
  assert.ok(!hash.includes(code));
  assert.notEqual(hash, hashCode(user, PURPOSES.RECOVER_ACCOUNT, code));
  assert.notEqual(hash, hashCode('64b7f9c2e4b0a1d2c3e4f507', PURPOSES.VERIFY_EMAIL, code));
});

test('a different pepper produces a different hash', () => {
  const code = '11112222';
  const user = '64b7f9c2e4b0a1d2c3e4f506';
  const original = process.env.EMAIL_CODE_PEPPER;
  const withFirst = hashCode(user, PURPOSES.VERIFY_EMAIL, code);
  process.env.EMAIL_CODE_PEPPER = 'another-pepper';
  const withSecond = hashCode(user, PURPOSES.VERIFY_EMAIL, code);
  process.env.EMAIL_CODE_PEPPER = original;

  assert.notEqual(withFirst, withSecond);
});

test('production refuses to hash without a configured pepper', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalPepper = process.env.EMAIL_CODE_PEPPER;
  delete process.env.EMAIL_CODE_PEPPER;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => hashCode('user', PURPOSES.VERIFY_EMAIL, '12345678'), /EMAIL_CODE_PEPPER/);
  } finally {
    process.env.NODE_ENV = originalEnv;
    process.env.EMAIL_CODE_PEPPER = originalPepper;
  }
});

test('challenge lifetimes match the documented policy', () => {
  assert.equal(TTL_MS, 10 * 60 * 1000);
  assert.equal(MAX_ATTEMPTS, 5);
  assert.equal(PURPOSES.VERIFY_EMAIL, 'verify_email');
  assert.equal(PURPOSES.VERIFY_RECOVERY, 'verify_recovery');
  assert.equal(PURPOSES.RECOVER_ACCOUNT, 'recover_account');
});

test('log redaction removes codes and tokens but keeps the rest', () => {
  const line = 'Your code is 48291573. Confirm at /verify-email?token=abc123def';
  const redacted = redactSecrets(line);
  assert.doesNotMatch(redacted, /48291573/);
  assert.match(redacted, /\*{8}/);
  assert.doesNotMatch(redacted, /abc123def/);
  assert.match(redacted, /Your code is/);
});

test('the confirmation code email carries no link', async () => {
  resetOutbox();
  await sendVerificationCodeEmail({
    to: 'player@example.com',
    username: '<script>',
    code: '20481635',
  });
  const [mail] = getOutbox();

  assert.equal(mail.subject, 'Your GamerHub confirmation code');
  assert.match(mail.text, /20481635/);
  assert.match(mail.text, /expires in 10 minutes/);
  assert.doesNotMatch(mail.text, /https?:\/\//);
  assert.doesNotMatch(mail.text, /token=/);
  assert.match(mail.html, /&lt;script&gt;/);
  assert.doesNotMatch(mail.html, /<script>/);
});

test('the recovery setup email names the address and the cooling-off rule', async () => {
  resetOutbox();
  await sendRecoverySetupCodeEmail({
    to: 'backup@example.com',
    username: 'player',
    code: '91827364',
  });
  const [mail] = getOutbox();

  assert.equal(mail.subject, 'Confirm your GamerHub recovery email');
  assert.match(mail.text, /91827364/);
  assert.match(mail.text, /cannot sign in/);
  assert.doesNotMatch(mail.text, /token=/);
});

test('the recovery code email warns without leaking a link', async () => {
  resetOutbox();
  await sendAccountRecoveryCodeEmail({
    to: 'backup@example.com',
    username: 'player',
    code: '55667788',
  });
  const [mail] = getOutbox();

  assert.equal(mail.subject, 'Your GamerHub account recovery code');
  assert.match(mail.text, /55667788/);
  assert.match(mail.text, /Nothing has changed on the account/);
  assert.doesNotMatch(mail.text, /https?:\/\//);
});

test('change and completion notices carry no credentials', async () => {
  resetOutbox();
  await sendRecoveryEmailChangedEmail({
    to: 'player@example.com',
    username: 'player',
    action: 'added',
    address: 'backup@example.com',
    eligibleAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  await sendRecoveryEmailChangedEmail({
    to: 'player@example.com',
    username: 'player',
    action: 'removed',
  });
  await sendAccountRecoveryCompletedEmail({ to: 'player@example.com', username: 'player' });

  const [added, removed, completed] = getOutbox();
  assert.equal(added.subject, 'Recovery email added to your GamerHub account');
  assert.match(added.text, /backup@example\.com/);
  assert.match(added.text, /can be used to recover the account from/);
  assert.equal(removed.subject, 'Recovery email removed');
  assert.match(removed.text, /can no longer be used/);
  assert.equal(completed.subject, 'Password reset through GamerHub account recovery');
  assert.match(completed.text, /signed out/);
  for (const mail of [added, removed, completed]) {
    assert.doesNotMatch(mail.text, /\d{8}/);
    assert.doesNotMatch(mail.text, /token=/);
  }
});
