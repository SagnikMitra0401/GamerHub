/**
 * Post-login destinations come from the URL, so they must never leave this
 * site. Only a single-slash absolute path is accepted; `//evil.example` and
 * protocol URLs fall back to the given page.
 */
export function safeRedirect(search, fallback = '/') {
  const raw = new URLSearchParams(search || '').get('redirect') || '';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  return raw;
}

/** Carry the current `?redirect=` onto a related auth link (login <-> register). */
export function withRedirect(path, search) {
  const raw = new URLSearchParams(search || '').get('redirect');
  return raw ? `${path}?redirect=${encodeURIComponent(raw)}` : path;
}
