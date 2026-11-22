const { publicBaseUrl } = require('./appUrl');

/**
 * Transactional email transport.
 *
 * The Gmail Apps Script bridge sends over HTTPS, so it works on hosts which
 * block outbound SMTP. Development can use the console transport, and tests
 * use an in-memory outbox so CI never touches the network. The rest of the
 * server only knows about `sendEmail`.
 */
const outbox = [];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function transportMode() {
  const explicit = String(process.env.EMAIL_TRANSPORT || '').trim().toLowerCase();
  if (explicit) return explicit;

  if (process.env.NODE_ENV === 'test') return 'memory';
  if (process.env.EMAIL_PROVIDER === 'console') return 'console';
  if (process.env.GMAIL_BRIDGE_URL) return 'apps-script';

  // Production must fail closed rather than print a token to the logs.
  return process.env.NODE_ENV === 'production' ? 'unconfigured' : 'console';
}

async function sendWithAppsScript({ to, subject, text, html }) {
  const url = String(process.env.GMAIL_BRIDGE_URL || '').trim();
  const secret = String(process.env.GMAIL_BRIDGE_SECRET || '').trim();
  if (!url) throw new Error('GMAIL_BRIDGE_URL is not configured.');
  if (!secret) throw new Error('GMAIL_BRIDGE_SECRET is not configured.');

  if (process.env.NODE_ENV === 'production' && !url.startsWith('https://')) {
    throw new Error('GMAIL_BRIDGE_URL must use HTTPS in production.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ secret, to, subject, text, html }),
      signal: controller.signal
    });

    const raw = await res.text();
    let result = {};
    try {
      result = JSON.parse(raw);
    } catch {
      // Apps Script can return an HTML login page when access is misconfigured.
    }

    if (!res.ok || result.ok !== true) {
      const reason = result.error ? `: ${String(result.error).slice(0, 40)}` : '';
      throw new Error(`Email bridge rejected the message (${res.status}${reason}).`);
    }

    return { id: result.id || 'apps-script' };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Email bridge timed out.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function sendEmail({ to, subject, text, html }) {
  const mode = transportMode();

  if (mode === 'memory') {
    // Push synchronously so a test can read the outbox immediately after the
    // endpoint responds, even when delivery is fire-and-forget.
    outbox.push({ to, subject, text, html, createdAt: new Date() });
    return { id: 'memory' };
  }

  if (mode === 'console') {
    // Local development only. This is the one place a link may be printed.
    console.log(`\n[Email:console] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return { id: 'console' };
  }

  if (mode === 'unconfigured') {
    throw new Error('Email transport is not configured.');
  }

  if (mode === 'apps-script') {
    return sendWithAppsScript({ to, subject, text, html });
  }

  throw new Error(`Unsupported EMAIL_TRANSPORT: ${mode}`);
}

function verificationUrl(req, token) {
  return `${publicBaseUrl(req)}/verify-email?token=${encodeURIComponent(token)}`;
}

function resetUrl(req, token) {
  return `${publicBaseUrl(req)}/reset-password?token=${encodeURIComponent(token)}`;
}

async function sendVerificationEmail({ to, username, url }) {
  const name = username ? `@${username}` : 'there';
  const subject = 'Confirm your GamerHub email';
  const text = [
    `Hi ${name},`,
    '',
    'Confirm this email address to finish securing your GamerHub account:',
    url,
    '',
    'This link expires in 24 hours. If you did not create an account, ignore this email.'
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:560px;margin:0 auto">
      <h2 style="margin:0 0 16px">Confirm your email</h2>
      <p>Hi ${escapeHtml(name)},</p>
      <p>Confirm this email address to finish securing your GamerHub account.</p>
      <p style="margin:24px 0">
        <a href="${escapeHtml(url)}" style="background:#6366f1;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">Verify email</a>
      </p>
      <p>This link expires in 24 hours. If you did not create an account, ignore this email.</p>
      <p style="color:#6b7280;font-size:12px;word-break:break-all">${escapeHtml(url)}</p>
    </div>
  `;

  return sendEmail({ to, subject, text, html });
}

async function sendPasswordResetEmail({ to, username, url }) {
  const name = username ? `@${username}` : 'there';
  const subject = 'Reset your GamerHub password';
  const text = [
    `Hi ${name},`,
    '',
    'Use this link to choose a new password:',
    url,
    '',
    'This link expires in 30 minutes and can only be used once.',
    'If you did not ask for a reset, ignore this email; your password has not changed.'
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:560px;margin:0 auto">
      <h2 style="margin:0 0 16px">Reset your password</h2>
      <p>Hi ${escapeHtml(name)},</p>
      <p>Use the button below to choose a new password.</p>
      <p style="margin:24px 0">
        <a href="${escapeHtml(url)}" style="background:#6366f1;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">Choose a new password</a>
      </p>
      <p>This link expires in 30 minutes and can only be used once. If you did not ask for a reset, ignore this email; your password has not changed.</p>
      <p style="color:#6b7280;font-size:12px;word-break:break-all">${escapeHtml(url)}</p>
    </div>
  `;

  return sendEmail({ to, subject, text, html });
}

/**
 * Business review correspondence. The reviewer writes the body; the template
 * only adds the business name and a fixed footer.
 */
async function sendBusinessReviewEmail({ to, displayName, message, outcome = 'contact' }) {
  const name = displayName || 'your business';
  const demoted = outcome === 'demoted';
  const subject = demoted
    ? 'GamerHub business account returned to a personal profile'
    : 'GamerHub business verification needs your attention';
  const heading = demoted ? 'Business account status changed' : 'Business verification';
  const intro = demoted
    ? `Your business account for ${name} has been returned to a personal profile after review.`
    : `A reviewer has looked at the verification for ${name} and needs a response.`;

  const text = [
    intro,
    '',
    message,
    '',
    demoted
      ? 'You can reply to this email if you believe this decision is wrong.'
      : 'Reply to this email with the requested information.',
    '',
    'GamerHub'
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:560px;margin:0 auto">
      <h2 style="margin:0 0 16px">${heading}</h2>
      <p>${escapeHtml(intro)}</p>
      <p style="white-space:pre-wrap">${escapeHtml(message)}</p>
      <p>${demoted
        ? 'You can reply to this email if you believe this decision is wrong.'
        : 'Reply to this email with the requested information.'}</p>
      <p style="color:#6b7280;font-size:12px">GamerHub</p>
    </div>
  `;

  return sendEmail({ to, subject, text, html });
}

/**
 * Retention notice: the application lapsed, or the 24-month evidence window
 * closed for a decided review. Deliberately factual — this is not a decision
 * email, and there is nothing to appeal in it.
 */
async function sendBusinessRetentionEmail({ to, displayName, kind, decidedAt }) {
  const name = displayName || 'your business';
  const decided = decidedAt ? new Date(decidedAt).toISOString().slice(0, 10) : 'the recorded decision date';
  const purged = kind === 'purged';
  const subject = purged
    ? 'GamerHub business review evidence deleted'
    : 'Your GamerHub business verification request expired';
  const heading = purged ? 'Review evidence deleted' : 'Verification request expired';

  const intro = purged
    ? `The official contact and proof details from the review of ${name} decided on ${decided} were deleted under our 24-month retention policy.`
    : `The verification request for ${name} expired because it had no activity for 90 days, or stayed open for 12 months.`;

  const aftermath = purged
    ? 'The decision, its reason and the review timeline stay on record. Your public business card, posts and followers are unchanged. If you apply again, we will collect fresh evidence.'
    : 'Nothing was removed from your account: your business profile, posts and followers are unchanged. You can apply again from business settings whenever you are ready.';

  const text = [intro, '', aftermath, '', 'GamerHub'].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:560px;margin:0 auto">
      <h2 style="margin:0 0 16px">${heading}</h2>
      <p>${escapeHtml(intro)}</p>
      <p>${escapeHtml(aftermath)}</p>
      <p style="color:#6b7280;font-size:12px">GamerHub</p>
    </div>
  `;

  return sendEmail({ to, subject, text, html });
}

/** Test-only helpers. The outbox is process-local and never persisted. */
function getOutbox() {
  return [...outbox];
}

function resetOutbox() {
  outbox.length = 0;
}

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendBusinessReviewEmail,
  sendBusinessRetentionEmail,
  verificationUrl,
  resetUrl,
  getOutbox,
  resetOutbox,
  transportMode
};
