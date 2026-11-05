/**
 * Patterns that identify a real credential rather than a variable name.
 *
 * Tuned for precision, not recall: a gate that fires on `process.env.JWT_SECRET`
 * or on documentation placeholders gets disabled within a week. Every pattern
 * here needs something only a real value has — a known issuer prefix, a private
 * key header, a quoted high-entropy string assigned to a secret-looking name.
 */

const PLACEHOLDER = /^(?:replace|your|example|changeme|placeholder|xxx|todo|<|\$\{)/i;
// A value that merely *says* it is a placeholder is not a leak, even when the
// issuer prefix looks right (docs and test fixtures use `sk_test_placeholder`).
// No word boundary: underscores are word characters, so `sk_test_placeholder`
// has none before "placeholder".
const PLACEHOLDER_WORD = /(?:placeholder|example|dummy|sample|replace|changeme|your[_-]?)/i;

const PATTERNS = [
  {
    name: 'database URI with credentials',
    // scheme://user:password@host — a real password is never an all-caps token.
    regex: /mongodb(?:\+srv)?:\/\/[^\s/:@]{2,}:(?!PASSWORD\b|password\b|pass\b|YOUR_)[^\s@]{3,}@/i
  },
  {
    name: 'AWS access key id',
    regex: /\bAKIA[0-9A-Z]{16}\b/
  },
  {
    name: 'Google API key',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/
  },
  {
    name: 'Stripe secret key',
    regex: /\bsk_(?:live|test)_[0-9A-Za-z]{10,}/
  },
  {
    name: 'private key block',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/
  },
  {
    name: 'quoted secret assignment',
    // env-like names assigned a quoted value of real length.
    regex: /(?:JWT_SECRET|API_SECRET|CLOUDINARY_API_SECRET|CLOUDINARY_API_KEY|UPSTASH_REDIS_REST_TOKEN|YOUTUBE_API_KEY|GOOGLE_CLIENT_SECRET)\s*[:=]\s*['"]([^'"]{12,})['"]/i
  },
  {
    name: 'generic assigned API key',
    regex: /(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*['"]([0-9A-Za-z_\-./+]{24,})['"]/i
  },
  {
    name: 'literal bearer token',
    regex: /['"]Bearer\s+eyJ[A-Za-z0-9_-]{20,}/
  }
];

/** Hide most of a match so the gate's own output cannot leak the secret. */
function redact(value) {
  const text = String(value || '');
  if (text.length <= 8) return '*'.repeat(text.length);
  return `${text.slice(0, 4)}…${'*'.repeat(Math.min(12, text.length - 4))}`;
}

/**
 * @param {string} text
 * @returns {{name: string, line: number, excerpt: string}[]}
 */
function scanText(text) {
  const hits = [];
  const lines = String(text || '').split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const pattern of PATTERNS) {
      const match = line.match(pattern.regex);
      if (!match) continue;

      const captured = match[1];
      if (captured && PLACEHOLDER.test(captured)) continue;
      if (PLACEHOLDER_WORD.test(match[0])) continue;

      hits.push({
        name: pattern.name,
        line: index + 1,
        excerpt: redact(match[0])
      });
      break; // one finding per line is enough to fail the gate
    }
  });

  return hits;
}

/** File extensions worth scanning for embedded credentials. */
const SCANNED_EXTENSIONS = [
  '.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.html', '.svg', '.yml', '.yaml'
];

module.exports = { PATTERNS, SCANNED_EXTENSIONS, redact, scanText };
