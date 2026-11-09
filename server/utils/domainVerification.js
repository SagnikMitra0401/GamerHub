const dns = require('dns').promises;

const RECORD_PREFIX = '_gamerhub-verify.';
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const TOKEN_PATTERN = /^[a-f0-9]{16,64}$/i;

function normalizeDomain(value) {
  const domain = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  return DOMAIN_PATTERN.test(domain) ? domain : '';
}

function flattenTxt(records) {
  if (!Array.isArray(records)) return [];
  return records
    .map((record) => (Array.isArray(record) ? record.join('') : String(record || '')))
    .map((record) => record.trim())
    .filter(Boolean);
}

function txtRecordMatches(records, token) {
  if (!TOKEN_PATTERN.test(String(token || ''))) return false;
  const expected = `gamerhub-verify=${token}`;
  return flattenTxt(records).includes(expected);
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('DNS lookup timed out')), timeoutMs);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Run a TXT lookup for the business verification record. Callers pass the
 * resolver only in tests; production uses Node's DNS resolver.
 */
async function checkDnsToken({
  domain,
  token,
  resolveTxt = dns.resolveTxt,
  timeoutMs = Number(process.env.BUSINESS_DNS_TIMEOUT_MS) || 5000
}) {
  const safeDomain = normalizeDomain(domain);
  if (!safeDomain) {
    return { ok: false, code: 'DNS_DOMAIN_INVALID', reason: 'Enter a valid domain first.' };
  }
  if (!TOKEN_PATTERN.test(String(token || ''))) {
    return { ok: false, code: 'DNS_TOKEN_INVALID', reason: 'Request a fresh DNS token first.' };
  }

  const recordName = `${RECORD_PREFIX}${safeDomain}`;
  try {
    const records = await withTimeout(
      Promise.resolve().then(() => resolveTxt(recordName)),
      Math.min(Math.max(Number(timeoutMs) || 5000, 500), 15000)
    );
    if (!txtRecordMatches(records, token)) {
      return {
        ok: false,
        code: 'DNS_RECORD_MISMATCH',
        reason: 'The TXT record does not match the current token yet.'
      };
    }
    return { ok: true, recordName, domain: safeDomain };
  } catch {
    return {
      ok: false,
      code: 'DNS_RECORD_MISSING',
      reason: 'No matching TXT record was found yet. DNS can take a few minutes to propagate.'
    };
  }
}

module.exports = {
  DOMAIN_PATTERN,
  RECORD_PREFIX,
  normalizeDomain,
  flattenTxt,
  txtRecordMatches,
  checkDnsToken
};
