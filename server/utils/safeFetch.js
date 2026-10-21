/**
 * SSRF-hardened outbound HTML fetch.
 *
 * The link-preview feature fetches URLs supplied by users, so every hop must be
 * validated: http(s) only, no credentials in the URL, no loopback / private /
 * link-local / metadata addresses (checked after DNS resolution too), limited
 * redirects and a hard byte cap on the response body.
 */
const dns = require('dns').promises;
const net = require('net');
const { HttpError } = require('./httpError');

const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal']);

function ipv4IsPrivate(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;

  if (a === 0) return true;                          // 0.0.0.0/8
  if (a === 10) return true;                         // 10/8
  if (a === 127) return true;                        // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true;           // link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16/12
  if (a === 192 && b === 168) return true;           // 192.168/16
  if (a === 192 && b === 0) return true;             // 192.0.0/24 + TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51) return true;            // TEST-NET-2
  if (a === 203 && b === 0) return true;             // TEST-NET-3
  if (a >= 224) return true;                         // multicast + reserved
  return false;
}

function ipv6IsPrivate(ip) {
  const normalized = ip.toLowerCase().split('%')[0];

  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fe80')) return true;        // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // ULA
  if (normalized.startsWith('ff')) return true;          // multicast

  // IPv4-mapped (::ffff:127.0.0.1)
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4IsPrivate(mapped[1]);

  return false;
}

/** @returns {boolean} true when the literal IP must never be fetched */
function isPrivateIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) return ipv4IsPrivate(ip);
  if (version === 6) return ipv6IsPrivate(ip);
  return true; // not an IP -> treat as unsafe
}

function assertSafeHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw new HttpError(400, 'Invalid URL');
  if (BLOCKED_HOSTNAMES.has(host)) throw new HttpError(400, 'This host is not allowed');
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    throw new HttpError(400, 'This host is not allowed');
  }
}

/**
 * Validate a URL string and every IP it resolves to.
 * @returns {Promise<URL>}
 */
async function assertPublicHttpUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    throw new HttpError(400, 'Invalid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'Only http and https URLs are supported');
  }
  if (url.username || url.password) {
    throw new HttpError(400, 'URLs with credentials are not allowed');
  }

  assertSafeHostname(url.hostname);

  // Literal IP
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(literal)) {
    if (isPrivateIp(literal)) throw new HttpError(400, 'This address is not allowed');
    return url;
  }

  let addresses;
  try {
    addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new HttpError(400, 'Could not resolve this host');
  }
  if (!addresses.length) throw new HttpError(400, 'Could not resolve this host');
  for (const { address } of addresses) {
    if (isPrivateIp(address)) throw new HttpError(400, 'This address is not allowed');
  }
  return url;
}

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

/**
 * Fetch an HTML page with SSRF protection.
 * @returns {Promise<{html: string, finalUrl: string}|null>} null for non-HTML/!ok
 */
async function safeFetchHtml(rawUrl, { timeoutMs = 6000, maxBytes = MAX_BYTES } = {}) {
  let current = (await assertPublicHttpUrl(rawUrl)).href;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, {
      redirect: 'manual',
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (REDIRECT_CODES.has(response.status)) {
      const location = response.headers.get('location');
      if (!location) return null;
      const next = new URL(location, current).href;
      current = (await assertPublicHttpUrl(next)).href; // validate the new hop
      continue;
    }

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;

    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return null;

    const reader = response.body?.getReader();
    if (!reader) return null;

    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        break; // parse what we have; OG tags live in <head>
      }
      chunks.push(Buffer.from(value));
    }

    return { html: Buffer.concat(chunks).toString('utf8'), finalUrl: current };
  }

  throw new HttpError(400, 'Too many redirects');
}

module.exports = { safeFetchHtml, assertPublicHttpUrl, isPrivateIp, MAX_BYTES };
