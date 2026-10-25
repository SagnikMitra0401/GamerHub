/**
 * jsdom has no `matchMedia`, and the components deliberately change shape based
 * on it: the notification bell swaps to a sheet below 640px, and the reaction
 * bar skips its spark burst on coarse pointers. Tests set the answers they need
 * with this stub instead of mocking the components' internals.
 */
import { vi } from 'vitest';

export function setMedia({ sheet = false, finePointer = true, reducedMotion = false } = {}) {
  const matches = query => {
    const text = String(query);
    if (text.includes('max-width')) return sheet;
    if (text.includes('pointer: fine')) return finePointer;
    if (text.includes('hover: hover')) return finePointer;
    if (text.includes('prefers-reduced-motion')) return reducedMotion;
    return false;
  };

  window.matchMedia = vi.fn(query => ({
    media: String(query),
    matches: matches(query),
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }));

  return window.matchMedia;
}
