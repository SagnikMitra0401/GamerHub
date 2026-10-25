import { useEffect, useRef } from 'react';

/**
 * Cursor spotlight for glass cards.
 *
 * The pointer position is written straight to CSS custom properties on the
 * hovered card, so moving the mouse never triggers a React render. The
 * listener is only attached on fine-pointer devices: on phones and tablets a
 * pointermove firehose is pure battery drain, and the cards fall back to their
 * static top sheen plus :active tap states.
 *
 * Usage:
 *   const glowRef = useCursorGlow();          // returns a ref for a container
 *   <main ref={glowRef}> ... <article className="glow-card" /> ... </main>
 *
 * Delegation means lists of cards need no per-card hooks.
 */
export default function useCursorGlow(selector = '.glow-card') {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || typeof window === 'undefined') return undefined;

    const media = window.matchMedia('(hover: hover) and (pointer: fine)');
    if (!media.matches) return undefined;

    let frame = 0;
    let pending = null;

    const paint = () => {
      frame = 0;
      if (!pending) return;
      const { card, x, y } = pending;
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mouse-x', `${x - rect.left}px`);
      card.style.setProperty('--mouse-y', `${y - rect.top}px`);
    };

    const onMove = (event) => {
      const target = event.target;
      const card = target instanceof Element ? target.closest(selector) : null;
      if (!card) return;
      pending = { card, x: event.clientX, y: event.clientY };
      if (!frame) frame = window.requestAnimationFrame(paint);
    };

    const onLeave = () => {
      if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
      pending = null;
    };

    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerleave', onLeave, { passive: true });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
    };
  }, [selector]);

  return ref;
}
