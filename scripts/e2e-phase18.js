/**
 * Phase 18 end-to-end verification — email codes, recovery email, recovery.
 *
 * Runs against a THROWAWAY database on the same cluster:
 *   node scripts/e2e-phase18.js
 *
 * Codes are read from the in-process memory outbox. They are never fetched over
 * HTTP, which is the property under test: the API response must not contain the
 * code, only the inbox may.
 */
require('dotenv').config();
const http = require('http');
const assert = require('assert/strict');
const mongoose = require('mongoose');

const E2E_DB = `gamerhub_e2e18_${Date.now().toString(36)}`;
const DAY_MS = 24 * 60 * 60 * 1000;

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
process.env.ACCOUNT_EMAIL_RATE_LIMIT_MAX = '1000';
process.env.ACCOUNT_PASSWORD_RATE_LIMIT_MAX = '1000';
process.env.EMAIL_TRANSPORT = 'memory';
process.env.EMAIL_CODE_PEPPER = 'phase18-test-pepper';
process.env.DISABLE_RETENTION_WORKER = '1';
process.env.REDIS_ENABLED = '0';
delete process.env.SENTRY_DSN;

const connectDB = require('../server/config/db');
const app = require('../server/app');
const User = require('../server/models/User');
const EmailChallenge = require('../server/models/EmailChallenge');
const { getOutbox, resetOutbox, sendVerificationCodeEmail } = require('../server/utils/email');
const { api, check, report, setBase, registerUser } = require('./lib/e2e-harness');

const CODE_SUBJECT = 'Your GamerHub confirmation code';
const SETUP_SUBJECT = 'Confirm your GamerHub recovery email';
const RECOVERY_SUBJECT = 'Your GamerHub account recovery code';

const waitForMail = async (to, subject, timeoutMs = 3000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const mail = getOutbox()
      .filter((item) => item.to === to && item.subject === subject)
      .at(-1);
    if (mail) return mail;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for "${subject}" to ${to}`);
};

/** Assert no matching mail arrives inside a short window. */
const expectNoMail = async (to, subject, timeoutMs = 800) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (getOutbox().some((item) => item.to === to && item.subject === subject)) {
      throw new Error(`Unexpected "${subject}" to ${to}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
};

const codeFrom = (mail) => {
  const match = String(mail?.text || '').match(/(?<!\d)(\d{8})(?!\d)/);
  assert.ok(match, 'no 8-digit code in mail');
  return match[1];
};

const wrongCodeFor = (code) => (code === '00000000' ? '11111111' : '00000000');

async function run() {
  await connectDB();
  console.log(`Using throwaway database: ${E2E_DB}`);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  setBase(`http://127.0.0.1:${server.address().port}`);

  try {
    resetOutbox();

    // ── registration, code shape, and the response body ────────────────────
    const registration = await api('/api/auth/register', {
      method: 'POST',
      body: {
        username: 'alice18',
        email: 'alice18@example.com',
        password: 'password123',
      },
    });
    const alice = {
      id: registration.data?.user?.id || registration.data?.user?._id,
      cookie: registration.cookie,
      email: 'alice18@example.com',
    };
    const registrationBody = JSON.stringify(registration.data || {});

    check('registration answers 201 and reports that a code was sent', () => {
      assert.equal(registration.status, 201, registrationBody);
      assert.equal(registration.data.verificationSent, true);
      assert.equal(registration.data.user.emailVerified, false);
    });

    const aliceMail = await waitForMail('alice18@example.com', CODE_SUBJECT);
    const aliceCode = codeFrom(aliceMail);

    check('the registration response never contains the code', () => {
      assert.ok(!registrationBody.includes(aliceCode));
      assert.ok(!('verificationCode' in (registration.data || {})));
      assert.ok(!('code' in (registration.data || {})));
    });

    check('the mail carries the code and no verification link', () => {
      assert.match(aliceMail.text, new RegExp(aliceCode));
      assert.doesNotMatch(aliceMail.text, /verify-email\?token=/);
      assert.match(aliceMail.text, /expires in 10 minutes/i);
    });

    const challengeRow = await EmailChallenge.findOne({ userId: alice.id }).lean();
    check('the challenge row stores a keyed hash, not the code', () => {
      assert.ok(challengeRow, 'no challenge row');
      assert.match(challengeRow.codeHash, /^[a-f0-9]{64}$/);
      assert.notEqual(challengeRow.codeHash, aliceCode);
      assert.ok(!JSON.stringify(challengeRow).includes(aliceCode));
      assert.equal(challengeRow.purpose, 'verify_email');
    });

    const anonymous = await api('/api/auth/verify-email/code', {
      method: 'POST',
      body: { code: aliceCode },
    });
    check('a code cannot be submitted without a session', () => {
      assert.equal(anonymous.status, 401);
    });

    const badCode = await api('/api/auth/verify-email/code', {
      method: 'POST',
      cookie: alice.cookie,
      body: { code: wrongCodeFor(aliceCode) },
    });
    check('a wrong code is refused and counts one attempt', () => {
      assert.equal(badCode.status, 400, JSON.stringify(badCode.data));
      assert.equal(badCode.data.code, 'EMAIL_CODE_INVALID');
      assert.equal(badCode.data.attemptsRemaining, 4);
    });

    const confirmed = await api('/api/auth/verify-email/code', {
      method: 'POST',
      cookie: alice.cookie,
      body: { code: aliceCode },
    });
    check('the right code confirms the email', () => {
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
      assert.equal(confirmed.data.emailVerified, true);
    });

    const aliceMe = await api('/api/auth/me', { cookie: alice.cookie });
    check('the session shows the verified state immediately', () => {
      assert.equal(aliceMe.data.user.emailVerified, true);
    });

    // ── resend retires the previous code ───────────────────────────────────
    resetOutbox();
    const bob = await registerUser('bob18');
    const bobFirstMail = await waitForMail('bob18@example.com', CODE_SUBJECT);
    const bobFirstCode = codeFrom(bobFirstMail);
    const bobResend = await api('/api/auth/verify-email/resend', {
      method: 'POST',
      cookie: bob.cookie,
    });
    const bobMails = getOutbox().filter(
      (item) => item.to === 'bob18@example.com' && item.subject === CODE_SUBJECT,
    );
    const bobLatestCode = codeFrom(bobMails.at(-1));

    check('a resend sends a different code', () => {
      assert.equal(bobResend.status, 200, JSON.stringify(bobResend.data));
      assert.equal(bobMails.length, 2);
      assert.notEqual(bobFirstCode, bobLatestCode);
    });

    const staleBob = await api('/api/auth/verify-email/code', {
      method: 'POST',
      cookie: bob.cookie,
      body: { code: bobFirstCode },
    });
    const freshBob = await api('/api/auth/verify-email/code', {
      method: 'POST',
      cookie: bob.cookie,
      body: { code: bobLatestCode },
    });
    check('only the newest code is accepted', () => {
      assert.equal(staleBob.status, 400);
      assert.equal(freshBob.status, 200, JSON.stringify(freshBob.data));
    });

    // ── five wrong attempts lock the challenge ─────────────────────────────
    resetOutbox();
    const lock = await registerUser('lock18');
    const lockMail = await waitForMail('lock18@example.com', CODE_SUBJECT);
    const lockCode = codeFrom(lockMail);
    const attempts = [];
    for (let i = 0; i < 5; i += 1) {
      attempts.push(
        await api('/api/auth/verify-email/code', {
          method: 'POST',
          cookie: lock.cookie,
          body: { code: wrongCodeFor(lockCode) },
        }),
      );
    }
    const lockedOut = await api('/api/auth/verify-email/code', {
      method: 'POST',
      cookie: lock.cookie,
      body: { code: lockCode },
    });
    check('five wrong guesses lock the live code, even for the right digits', () => {
      assert.deepEqual(
        attempts.map((item) => item.status),
        [400, 400, 400, 400, 400],
      );
      assert.equal(attempts.at(-1).data.attemptsRemaining, 0);
      assert.equal(lockedOut.status, 400);
    });

    await api('/api/auth/verify-email/resend', { method: 'POST', cookie: lock.cookie });
    const lockMails = getOutbox().filter(
      (item) => item.to === 'lock18@example.com' && item.subject === CODE_SUBJECT,
    );
    const recoveredLock = await api('/api/auth/verify-email/code', {
      method: 'POST',
      cookie: lock.cookie,
      body: { code: codeFrom(lockMails.at(-1)) },
    });
    check('a resend clears the lock and the new code works', () => {
      assert.equal(recoveredLock.status, 200, JSON.stringify(recoveredLock.data));
    });

    // ── recovery email: verification required first ────────────────────────
    const gate = await registerUser('gate18');
    const gateAttempt = await api('/api/auth/recovery-email', {
      method: 'POST',
      cookie: gate.cookie,
      body: { email: 'gate18.backup@example.com' },
    });
    check('a recovery email needs a verified primary address', () => {
      assert.equal(gateAttempt.status, 403, JSON.stringify(gateAttempt.data));
      assert.equal(gateAttempt.data.code, 'EMAIL_NOT_VERIFIED');
    });

    resetOutbox();
    const primaryAttempt = await api('/api/auth/recovery-email', {
      method: 'POST',
      cookie: alice.cookie,
      body: { email: 'alice18@example.com' },
    });
    check('the primary address cannot also be the backup', () => {
      assert.equal(primaryAttempt.status, 400, JSON.stringify(primaryAttempt.data));
    });

    const addBackup = await api('/api/auth/recovery-email', {
      method: 'POST',
      cookie: alice.cookie,
      body: { email: 'alice18.backup@example.com' },
    });
    check('a verified account can start adding a backup address', () => {
      assert.equal(addBackup.status, 202, JSON.stringify(addBackup.data));
      assert.equal(addBackup.data.sent, true);
    });

    const beforeConfirm = await api('/api/auth/me', { cookie: alice.cookie });
    check('an unconfirmed backup address is not stored on the account', () => {
      assert.ok(!beforeConfirm.data.user.recoveryEmail);
    });

    const setupMail = await waitForMail('alice18.backup@example.com', SETUP_SUBJECT);
    const setupCode = codeFrom(setupMail);

    const wrongSetup = await api('/api/auth/recovery-email/verify', {
      method: 'POST',
      cookie: alice.cookie,
      body: { code: wrongCodeFor(setupCode) },
    });
    check('a wrong backup code is refused', () => {
      assert.equal(wrongSetup.status, 400, JSON.stringify(wrongSetup.data));
      assert.equal(wrongSetup.data.attemptsRemaining, 4);
    });

    const confirmedBackup = await api('/api/auth/recovery-email/verify', {
      method: 'POST',
      cookie: alice.cookie,
      body: { code: setupCode },
    });
    const eligibleAt = new Date(confirmedBackup.data?.recoveryEligibleAt || 0).getTime();
    check('the right backup code stores the address with a cooling-off date', () => {
      assert.equal(confirmedBackup.status, 200, JSON.stringify(confirmedBackup.data));
      assert.equal(confirmedBackup.data.recoveryEmail, 'alice18.backup@example.com');
      const days = (eligibleAt - Date.now()) / DAY_MS;
      assert.ok(days > 6.9 && days < 7.1, `expected about 7 days, got ${days}`);
    });

    const noticeToPrimary = getOutbox().some(
      (item) => item.to === 'alice18@example.com' && /Recovery email added/.test(item.subject),
    );
    const noticeToBackup = getOutbox().some(
      (item) =>
        item.to === 'alice18.backup@example.com' && /Recovery email added/.test(item.subject),
    );
    check('both inboxes are told about the new recovery path', () => {
      assert.equal(noticeToPrimary, true);
      assert.equal(noticeToBackup, true);
    });

    // ── recovery: generic answer, then the waiting period ──────────────────
    resetOutbox();
    const earlyStart = await api('/api/auth/recovery/start', {
      method: 'POST',
      body: { username: 'alice18', recoveryEmail: 'alice18.backup@example.com' },
    });
    const noMailDuringWait = await expectNoMail('alice18.backup@example.com', RECOVERY_SUBJECT);
    check('recovery inside the waiting period sends nothing', () => {
      assert.equal(earlyStart.status, 202);
      assert.equal(noMailDuringWait, true);
    });

    const wrongAddressStart = await api('/api/auth/recovery/start', {
      method: 'POST',
      body: { username: 'alice18', recoveryEmail: 'stranger18@example.com' },
    });
    const unknownStart = await api('/api/auth/recovery/start', {
      method: 'POST',
      body: { username: 'nobody_here_18', recoveryEmail: 'stranger18@example.com' },
    });
    check('recovery start looks the same for wrong and unknown details', () => {
      assert.deepEqual(wrongAddressStart.data, earlyStart.data);
      assert.deepEqual(unknownStart.data, earlyStart.data);
      assert.equal(unknownStart.status, 202);
    });

    await User.updateOne(
      { _id: alice.id },
      { $set: { recoveryEligibleAt: new Date(Date.now() - 1000) } },
    );
    const start = await api('/api/auth/recovery/start', {
      method: 'POST',
      body: { username: 'alice18', recoveryEmail: 'alice18.backup@example.com' },
    });
    const recoveryMail = await waitForMail('alice18.backup@example.com', RECOVERY_SUBJECT);
    const recoveryCode = codeFrom(recoveryMail);

    check('an eligible recovery sends a code to the backup address only', () => {
      assert.equal(start.status, 202);
      assert.equal(getOutbox().filter((item) => item.subject === RECOVERY_SUBJECT).length, 1);
      assert.doesNotMatch(recoveryMail.text, /verify-email\?token=/);
    });

    const wrongRecovery = await api('/api/auth/recovery/verify', {
      method: 'POST',
      body: {
        username: 'alice18',
        code: wrongCodeFor(recoveryCode),
        newPassword: 'recovered123',
      },
    });
    check('a wrong recovery code cannot reset the password', () => {
      assert.equal(wrongRecovery.status, 400, JSON.stringify(wrongRecovery.data));
    });

    const recovery = await api('/api/auth/recovery/verify', {
      method: 'POST',
      body: {
        username: 'alice18',
        code: recoveryCode,
        newPassword: 'recovered123',
      },
    });
    check('the right recovery code sets a new password', () => {
      assert.equal(recovery.status, 200, JSON.stringify(recovery.data));
      assert.equal(recovery.data.recovered, true);
    });

    const oldPassword = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'alice18@example.com', password: 'password123' },
    });
    const newPassword = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'alice18@example.com', password: 'recovered123' },
    });
    check('recovery replaces the password and revokes the old one', () => {
      assert.equal(oldPassword.status, 401);
      assert.equal(newPassword.status, 200, JSON.stringify(newPassword.data));
    });

    const oldSession = await api('/api/auth/me', { cookie: alice.cookie });
    check('recovery ends every session that was open', () => {
      assert.equal(oldSession.status, 401);
    });

    const aliceDoc = await User.findById(alice.id)
      .select('email emailVerifiedAt recoveryEmail recoveryEligibleAt')
      .lean();
    check('recovery leaves the primary address verified and unchanged', () => {
      assert.equal(aliceDoc.email, 'alice18@example.com');
      assert.ok(aliceDoc.emailVerifiedAt, 'primary address lost its verification');
      assert.equal(aliceDoc.recoveryEmail, 'alice18.backup@example.com');
    });

    const backupLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'alice18.backup@example.com', password: 'recovered123' },
    });
    check('the backup address is not a sign-in identity', () => {
      assert.equal(backupLogin.status, 401);
    });

    // ── removing the backup path kills recovery in flight ──────────────────
    const login = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'alice18@example.com', password: 'recovered123' },
    });
    const remove = await api('/api/auth/recovery-email', {
      method: 'DELETE',
      cookie: login.cookie,
    });
    const afterRemove = await api('/api/auth/me', { cookie: login.cookie });
    check('removing the recovery email clears the stored address', () => {
      assert.equal(remove.status, 200, JSON.stringify(remove.data));
      assert.ok(!afterRemove.data.user.recoveryEmail);
      assert.ok(!afterRemove.data.user.recoveryEligibleAt);
    });

    // ── the console transport must never print a code ──────────────────────
    const previousTransport = process.env.EMAIL_TRANSPORT;
    const logged = [];
    const originalLog = console.log;
    process.env.EMAIL_TRANSPORT = 'console';
    console.log = (...args) => logged.push(args.join(' '));
    try {
      await sendVerificationCodeEmail({
        to: 'redact18@example.com',
        username: 'redact18',
        code: '12345678',
      });
    } finally {
      console.log = originalLog;
      process.env.EMAIL_TRANSPORT = previousTransport;
    }
    check('the console transport redacts an 8-digit code', () => {
      const output = logged.join('\n');
      assert.ok(output.includes('redact18@example.com'), 'console transport printed nothing');
      assert.doesNotMatch(output, /\b12345678\b/);
      assert.match(output, /\*{8}/);
    });

    const tally = report();
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    process.exit(tally.length ? 1 : 0);
  } catch (err) {
    console.error(err);
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

run();
