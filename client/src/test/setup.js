import '@testing-library/jest-dom/vitest';

/**
 * jsdom ships no `matchMedia`, but the components are built around it: the
 * reaction bar asks about pointer capability and the notification bell about
 * width. A default that matches nothing keeps every test honest — nothing gets
 * a capability it did not ask for — and `setMedia()` in `src/test/media.js`
 * overrides the answers a test actually cares about.
 */
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = query => ({
    media: String(query),
    matches: false,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  });
}
