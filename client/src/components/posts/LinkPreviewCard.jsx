import React, { useState } from 'react';

/**
 * LinkPreviewCard
 * ─────────────────────────────────────────────────────────────────
 * Shared component displayed both:
 *   • INSIDE PostForm  (while composing — with optional dismiss button)
 *   • INSIDE PostCard  (in the feed — as a clickable link)
 *
 * Props:
 *   preview   {url, title, description, image, siteName}
 *   onDismiss optional callback — renders an ✕ button when provided
 *   clickable true by default; wraps in <a> for feed cards
 */
const LinkPreviewCard = ({ preview, onDismiss, clickable = true }) => {
  const [imgError, setImgError] = useState(false);

  if (!preview || !preview.url) return null;

  const hostname = (() => {
    try { return new URL(preview.url).hostname.replace(/^www\./, ''); }
    catch { return preview.siteName || 'link'; }
  })();

  const displaySite = preview.siteName || hostname;

  const inner = (
    <div
      style={{
        display: 'flex',
        minHeight: preview.image && !imgError ? '100px' : 'auto',
        position: 'relative',
      }}
    >
      {/* Thumbnail */}
      {preview.image && !imgError && (
        <div
          style={{
            width: '130px',
            minWidth: '130px',
            height: '130px',
            overflow: 'hidden',
            background: 'var(--bg-elevated)',
            flexShrink: 0,
          }}
        >
          <img
            src={preview.image}
            alt={preview.title || 'preview'}
            onError={() => setImgError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      )}

      {/* Text block */}
      <div
        style={{
          padding: '0.8rem 1rem',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: '0.2rem',
          overflow: 'hidden',
          flex: 1,
        }}
      >
        {/* Site pill */}
        <span
          style={{
            fontSize: '0.68rem',
            fontWeight: 700,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: 'var(--primary-light)',
            marginBottom: '0.15rem',
          }}
        >
          🔗 {displaySite}
        </span>

        {/* Title */}
        <h4
          style={{
            fontSize: '0.9rem',
            fontWeight: 700,
            margin: 0,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            lineHeight: 1.35,
          }}
        >
          {preview.title || 'Untitled'}
        </h4>

        {/* Description */}
        {preview.description && (
          <p
            className="text-muted"
            style={{
              fontSize: '0.76rem',
              margin: 0,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              lineHeight: 1.45,
            }}
          >
            {preview.description}
          </p>
        )}
      </div>

      {/* Dismiss button (only in form mode) */}
      {onDismiss && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDismiss(); }}
          title="Remove preview"
          style={{
            position: 'absolute',
            top: '6px',
            right: '6px',
            background: 'rgba(0,0,0,0.55)',
            border: 'none',
            borderRadius: '50%',
            width: '24px',
            height: '24px',
            cursor: 'pointer',
            color: '#fff',
            fontSize: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
            zIndex: 2,
          }}
        >
          ✕
        </button>
      )}
    </div>
  );

  const cardStyle = {
    marginTop: '0.75rem',
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
    border: '1px solid var(--border)',
    background: 'var(--bg-surface)',
    color: 'inherit',
    transition: 'background var(--transition), border-color var(--transition)',
    textDecoration: 'none',
    display: 'block',
  };

  if (clickable) {
    return (
      <a
        href={preview.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        style={cardStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-elevated)';
          e.currentTarget.style.borderColor = 'var(--border-hover)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--bg-surface)';
          e.currentTarget.style.borderColor = 'var(--border)';
        }}
      >
        {inner}
      </a>
    );
  }

  return <div style={cardStyle}>{inner}</div>;
};

export default LinkPreviewCard;
