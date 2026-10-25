import React from 'react';

/**
 * Server identity mark.
 *
 * Communities used to pick an emoji as their avatar, which read as a different
 * visual language on every platform (and clashed with the obsidian/chrome UI).
 * The sigil instead renders a brushed-metal monogram derived from the server
 * name, with a hue tinted from that same name. Two servers with the same name
 * still get the same mark, so it behaves like a stable identity.
 *
 * A legacy `icon` value that is an image URL is still honoured.
 */
const isImage = (value) =>
  typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/'));

const hashHue = (value) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 360;
  }
  return hash;
};

const initialsOf = (name) => {
  const words = String(name || '')
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
};

const CommunitySigil = ({ name = '', icon = '', size = 40, className = '' }) => {
  const label = name || 'GamingHub';
  const classes = `community-sigil${className ? ` ${className}` : ''}`;

  if (isImage(icon)) {
    return (
      <span className={`${classes} community-sigil-image`} style={{ width: size, height: size }} aria-hidden="true">
        <img src={icon} alt="" loading="lazy" />
      </span>
    );
  }

  return (
    <span
      className={classes}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.round(size * 0.4)),
        '--sigil-hue': hashHue(label.toLowerCase())
      }}
      aria-hidden="true"
    >
      {initialsOf(label)}
    </span>
  );
};

export default CommunitySigil;
