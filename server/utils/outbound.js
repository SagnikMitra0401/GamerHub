/**
 * Outbound JSON fetching with hard limits.
 *
 * Every caller passes a fixed, trusted base URL — no user-supplied host is ever
 * fetched here (the SSRF-safe scraper lives in utils/scrapePreview.js).
 * Redirects are refused so a compromised upstream cannot bounce us elsewhere,
 * and the response is size-capped before parsing.
 */

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

class UpstreamError extends Error {
  constructor(message, { status = null, cause = null } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    if (cause) this.cause = cause;
  }
}

async function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': 'GamerHub/1.0', ...headers },
      signal: controller.signal,
      redirect: 'error'
    });

    if (!res.ok) {
      throw new UpstreamError(`Upstream responded ${res.status}`, { status: res.status });
    }

    const text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new UpstreamError('Upstream response too large');
    }

    try {
      return JSON.parse(text);
    } catch (err) {
      throw new UpstreamError('Upstream returned malformed JSON', { cause: err });
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new UpstreamError(`Upstream timed out after ${timeoutMs}ms`);
    }
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError(err.message || 'Upstream request failed', { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchJson, UpstreamError, DEFAULT_TIMEOUT_MS, MAX_RESPONSE_BYTES };
