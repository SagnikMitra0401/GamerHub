/**
 * Video source helpers.
 *
 * Pure functions so the YouTube parsing can be unit-tested without a network
 * call. Nothing here trusts client-provided ids: the controller re-derives the
 * id from the URL that was actually scraped for the post.
 */

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'youtu.be'
]);

/** @returns {string|null} the 11-character video id, or null. */
function parseYouTubeId(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;

  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;

  let id = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/').filter(Boolean)[0] || null;
  } else if (url.searchParams.get('v')) {
    id = url.searchParams.get('v');
  } else {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && ['shorts', 'embed', 'live', 'v'].includes(parts[0])) {
      id = parts[1];
    }
  }

  return id && YOUTUBE_ID.test(id) ? id : null;
}

/** First YouTube id mentioned in free text, if any. */
function findYouTubeIdInText(text) {
  if (typeof text !== 'string' || !text) return null;
  const matches = text.match(/https?:\/\/[^\s<>"']+/gi) || [];
  for (const candidate of matches) {
    const id = parseYouTubeId(candidate);
    if (id) return id;
  }
  return null;
}

/** Poster frame for the click-to-load facade (no API key needed). */
function youtubeThumbnail(id) {
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

/** Embed URL uses the privacy-enhanced host. */
function youtubeEmbedUrl(id, { autoplay = false } = {}) {
  if (!id) return null;
  const params = new URLSearchParams({ rel: '0', modestbranding: '1' });
  if (autoplay) params.set('autoplay', '1');
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
}

/** Bounded, integer duration in seconds; null when unusable. */
function normalizeDuration(value, max = 36_000) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(Math.round(seconds), max);
}

module.exports = {
  YOUTUBE_ID,
  parseYouTubeId,
  findYouTubeIdInText,
  youtubeThumbnail,
  youtubeEmbedUrl,
  normalizeDuration
};
