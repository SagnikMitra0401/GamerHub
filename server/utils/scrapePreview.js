/**
 * scrapePreview.js
 * Fetches the first URL found in a text string and extracts
 * Open Graph / Twitter Card metadata.
 *
 * All outbound requests go through `safeFetchHtml`, which blocks loopback,
 * private, link-local and metadata addresses (including after DNS resolution
 * and on every redirect hop), caps the response body and enforces a timeout.
 */

const { safeFetchHtml } = require('./safeFetch');
const { sanitizeLine } = require('./sanitize');

const URL_REGEX = /(https?:\/\/[^\s"'<>]+)/i;
const BARE_URL_REGEX = /((?:[a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}(?:\/[^\s"'<>]*)?)/i;

/**
 * Normalise a raw user-pasted value into a full https:// URL.
 * e.g. "youtube.com/watch?v=abc" → "https://youtube.com/watch?v=abc"
 */
function normaliseUrl(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^\/\//i.test(trimmed)) return `https:${trimmed}`;
  if (/^[a-zA-Z0-9]/.test(trimmed)) return `https://${trimmed}`;
  return null;
}

/** Extract the first URL from arbitrary text (strict pattern first, then bare domain). */
function extractUrl(text) {
  if (!text) return null;
  const strict = String(text).match(URL_REGEX);
  if (strict) return strict[0];
  const bare = String(text).match(BARE_URL_REGEX);
  if (bare) return normaliseUrl(bare[0]);
  return null;
}

/** Pull a single meta attribute value using two attribute-order patterns. */
function getMetaContent(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rA = new RegExp(
    `<meta[^>]*(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']+)["']`,
    'i'
  );
  const rB = new RegExp(
    `<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${escaped}["']`,
    'i'
  );
  const mA = html.match(rA);
  if (mA) return mA[1];
  const mB = html.match(rB);
  return mB ? mB[1] : null;
}

/** Decode common HTML entities. */
function decode(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** Resolve a potentially relative image URL against the page URL. */
function resolveImage(imgUrl, pageUrl) {
  if (!imgUrl) return '';
  if (/^https?:\/\//i.test(imgUrl)) return imgUrl;
  try {
    return new URL(imgUrl, pageUrl).href;
  } catch {
    return '';
  }
}

/**
 * Core scrape function.
 * @param {string} rawUrl  - Already-normalised http(s) URL
 * @param {number} timeoutMs
 */
async function scrapeUrl(rawUrl, timeoutMs = 6000) {
  const page = await safeFetchHtml(rawUrl, { timeoutMs });
  if (!page) return null;

  const { html, finalUrl } = page;

  let title =
    getMetaContent(html, 'og:title') ||
    getMetaContent(html, 'twitter:title') ||
    '';
  if (!title) {
    const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (t) title = t[1];
  }

  const description =
    getMetaContent(html, 'og:description') ||
    getMetaContent(html, 'twitter:description') ||
    getMetaContent(html, 'description') ||
    '';

  let image =
    getMetaContent(html, 'og:image') ||
    getMetaContent(html, 'og:image:url') ||
    getMetaContent(html, 'twitter:image') ||
    getMetaContent(html, 'twitter:image:src') ||
    '';
  image = resolveImage(image, finalUrl);

  const siteName =
    getMetaContent(html, 'og:site_name') ||
    getMetaContent(html, 'twitter:site') ||
    '';

  if (!title && !description) return null;

  return {
    url: finalUrl,
    title: sanitizeLine(decode(title), 200),
    description: sanitizeLine(decode(description), 500),
    image: /^https?:\/\//i.test(image) ? image.slice(0, 2048) : '',
    siteName: sanitizeLine(decode(siteName).replace(/^@/, ''), 80)
  };
}

/**
 * Public API used by the route handler and the post controller.
 *
 * @param {string} text   - Free-form text that may contain a URL
 * @param {number} timeoutMs
 * @returns {object|null} preview object or null
 */
const scrapePreview = async (text, timeoutMs = 6000) => {
  const raw = extractUrl(text);
  if (!raw) return null;
  const url = normaliseUrl(raw);
  if (!url) return null;

  try {
    return await scrapeUrl(url, timeoutMs);
  } catch {
    return null; // Always fail silently — never block post creation
  }
};

module.exports = { scrapePreview, scrapeUrl, normaliseUrl, extractUrl };
