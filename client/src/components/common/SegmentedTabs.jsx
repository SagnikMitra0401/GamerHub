import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Segmented control with a single sliding pill.
 *
 * The active pill is one absolutely-positioned element whose position and size
 * are written to the tray as CSS custom properties. Moving between tabs is a
 * pure compositor transform (`translate3d`) with a spring-like easing curve —
 * no timers, no animation loop, no React state churn per frame. Once the pill
 * settles the browser stops work entirely.
 *
 * Measurement happens only on mount, when the active index changes, and when
 * the tray actually resizes (ResizeObserver + font load), so an idle control
 * consumes nothing.
 *
 * Usage:
 *   <SegmentedTabs
 *     ariaLabel="Sort posts"
 *     value={sort}
 *     onChange={setSort}
 *     options={[{ key: 'latest', label: 'Latest', icon: <ClockIcon /> }]}
 *   />
 */
const SegmentedTabs = ({
  options = [],
  value,
  onChange,
  ariaLabel,
  className = '',
  size = 'md'
}) => {
  const trayRef = useRef(null);
  const [ready, setReady] = useState(false);
  const activeIndex = options.findIndex(option => option.key === value);

  const measure = useCallback(() => {
    const tray = trayRef.current;
    if (!tray) return;
    const buttons = tray.querySelectorAll('[data-seg-item]');
    const active = buttons[activeIndex];
    if (!active) return;
    tray.style.setProperty('--seg-x', `${active.offsetLeft}px`);
    tray.style.setProperty('--seg-w', `${active.offsetWidth}px`);
  }, [activeIndex]);

  // Layout effect so the pill is already in place on the first paint instead of
  // sliding in from the left edge.
  useLayoutEffect(() => { measure(); }, [measure]);

  // Transitions stay off for the very first frame: the pill should appear at
  // its tab, not grow into place from the tray's left edge.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const tray = trayRef.current;
    if (!tray || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => measure());
    observer.observe(tray);
    tray.querySelectorAll('[data-seg-item]').forEach(button => observer.observe(button));

    // Web fonts land after first paint and shift label widths.
    if (document.fonts?.ready) {
      document.fonts.ready.then(measure).catch(() => {});
    }

    return () => observer.disconnect();
  }, [measure, options.length]);

  return (
    <div
      ref={trayRef}
      className={`seg-tray seg-tray--${size} ${ready ? 'is-ready' : ''} ${className}`.trim()}
      role="group"
      aria-label={ariaLabel}
    >
      <span className="seg-indicator" aria-hidden="true" />
      {options.map(option => {
        const isActive = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            data-seg-item
            className={`seg-btn ${isActive ? 'is-active' : ''}`}
            aria-pressed={isActive}
            onClick={() => onChange?.(option.key)}
          >
            {option.icon && <span className="seg-icon">{option.icon}</span>}
            <span className="seg-label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default SegmentedTabs;
