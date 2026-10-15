/**
 * scrapePreview.js
 * Fetches the first URL found in a text string and extracts
 * Open Graph / Twitter Card / oEmbed metadata.
 *
 * Supports: YouTube, Twitter/X, Facebook, Instagram, Bilibili,
 *           Reddit, Steam, Twitch, TikTok, and any site with OG tags.
 * No API keys required — all standard HTML meta tags.
 */

const URL_REGEX = /(https?:\/\/[^\s"'<>]+)/i;
const BARE_URL_REGEX = /((?:[a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}(?:\/[^\s"'<>]*)?)/i;

/**
 * Normalise a raw user-pasted value into a full https:// URL.
 * e.g. "youtube.com/watch?v=abc" → "https://youtube.com/watch?v=abc"
 */
function normaliseUrl(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^\/\//i.test(trimmed)) return `https:${trimmed}`;
  if (/^[a-zA-Z0-9]/.test(trimmed)) return `https://${trimmed}`;
  return null;
}

/**
 * Extract the first URL from arbitrary text (title + description).
 * Tries strict https?:// pattern first, then bare-domain fallback.
 */
function extractUrl(text) {
  if (!text) return null;
  const strict = text.match(URL_REGEX);
  if (strict) return strict[0];
  const bare = text.match(BARE_URL_REGEX);
  if (bare) return normaliseUrl(bare[0]);
  return null;
}

/**
 * Pull a single meta attribute value using two attribute-order patterns.
 */
function getMetaContent(html, name) {
  // Pattern A:  <meta property="og:title" content="val">
  const rA = new RegExp(
    `<meta[^>]*(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`,
    'i'
  );
  // Pattern B:  <meta content="val" property="og:title">
  const rB = new RegExp(
    `<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`,
    'i'
  );
  const mA = html.match(rA);
  if (mA) return mA[1];
  const mB = html.match(rB);
  return mB ? mB[1] : null;
}

/** Decode common HTML entities */
function decode(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** Resolve a potentially relative image URL against the page origin */
function resolveImage(imgUrl, pageUrl) {
  if (!imgUrl) return '';
  if (/^https?:\/\//i.test(imgUrl)) return imgUrl;
  try {
    return new URL(imgUrl, pageUrl).href;
  } catch {
    return imgUrl;
  }
}

/**
 * Core scrape function.
 * @param {string} rawUrl  - Already-normalised https:// URL
 * @param {number} timeoutMs
 */
async function scrapeUrl(rawUrl, timeoutMs = 8000) {
  const response = await fetch(rawUrl, {
    redirect: 'follow',
    headers: {
      // Present as a browser so sites serve full HTML (not JS-only shells)
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) return null;

  // Only parse text/html responses — skip binary / JSON / etc.
  const ct = response.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return null;

  const html = await response.text();

  // ── Title ────────────────────────────────────────────────────────────────
  let title =
    getMetaContent(html, 'og:title') ||
    getMetaContent(html, 'twitter:title') ||
    '';
  if (!title) {
    const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (t) title = t[1];
  }

  // ── Description ──────────────────────────────────────────────────────────
  const description =
    getMetaContent(html, 'og:description') ||
    getMetaContent(html, 'twitter:description') ||
    getMetaContent(html, 'description') ||
    '';

  // ── Image ─────────────────────────────────────────────────────────────────
  let image =
    getMetaContent(html, 'og:image') ||
    getMetaContent(html, 'og:image:url') ||
    getMetaContent(html, 'twitter:image') ||
    getMetaContent(html, 'twitter:image:src') ||
    '';
  image = resolveImage(image, rawUrl);

  // ── Site name ─────────────────────────────────────────────────────────────
  const siteName =
    getMetaContent(html, 'og:site_name') ||
    getMetaContent(html, 'twitter:site') ||
    '';

  if (!title && !description) return null;

  return {
    url: rawUrl,
    title: decode(title).slice(0, 200),
    description: decode(description).slice(0, 500),
    image: decode(image),
    siteName: decode(siteName).replace(/^@/, ''),
  };
}

/**
 * Public API used by the route handler and the post controller.
 *
 * @param {string} text   - Free-form text that may contain a URL
 * @param {number} timeoutMs
 * @returns {object|null} preview object or null
 */
const scrapePreview = async (text, timeoutMs = 8000) => {
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

module.exports = { scrapePreview, normaliseUrl, extractUrl };
