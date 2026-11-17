/**
 * GamerHub Gmail bridge
 *
 * Paste this file into a Google Apps Script project, set SECRET, then deploy it
 * as a web app (Execute as: Me, Who has access: Anyone).
 *
 * Full instructions: docs/GMAIL_BRIDGE.md
 */

// Replace this with the same long random value you put in GMAIL_BRIDGE_SECRET.
// Do not use the placeholder. Generate one with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
const SECRET = 'PASTE_A_LONG_RANDOM_SECRET_HERE';

const MAX_PER_MINUTE = 30;
const MAX_BODY_BYTES = 100000;

function doGet() {
  return json({ ok: true, service: 'gamerhub-email-bridge' });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ ok: false, error: 'empty' });
    }

    if (e.postData.contents.length > MAX_BODY_BYTES) {
      return json({ ok: false, error: 'too_large' });
    }

    const body = JSON.parse(e.postData.contents);

    if (!SECRET || SECRET === 'PASTE_A_LONG_RANDOM_SECRET_HERE') {
      return json({ ok: false, error: 'secret_not_set' });
    }

    if (!safeEqual(String(body.secret || ''), SECRET)) {
      return json({ ok: false, error: 'forbidden' });
    }

    const to = String(body.to || '').trim();
    const subject = String(body.subject || '').trim().slice(0, 200);
    const text = String(body.text || '');
    const html = String(body.html || '');

    if (!isEmail(to) || !subject || (!text && !html)) {
      return json({ ok: false, error: 'invalid' });
    }

    if (!allowRequest()) {
      return json({ ok: false, error: 'rate_limited' });
    }

    const options = { name: 'GamerHub' };
    if (html) options.htmlBody = html;

    MailApp.sendEmail(to, subject, text || stripHtml(html), options);
    return json({ ok: true });
  } catch (err) {
    // Keep the response generic; inspect Executions in the Apps Script editor.
    console.error(err);
    return json({ ok: false, error: 'failed' });
  }
}

function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function stripHtml(value) {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function allowRequest() {
  const cache = CacheService.getScriptCache();
  const key = `gamerhub:${Math.floor(Date.now() / 60000)}`;
  const current = Number(cache.get(key) || 0);
  if (current >= MAX_PER_MINUTE) return false;
  cache.put(key, String(current + 1), 120);
  return true;
}
