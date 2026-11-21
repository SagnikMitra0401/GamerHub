import React, { useState } from 'react';

/**
 * Click-to-load YouTube player.
 *
 * The facade keeps the page light: nothing is requested from YouTube until the
 * viewer presses play, and the embed itself uses youtube-nocookie.com. A post
 * id is never trusted from props beyond its shape — the server derives it.
 */
const YouTubeEmbed = ({ videoId, title = 'YouTube video', autoplay = false, className = '' }) => {
  const [playing, setPlaying] = useState(false);

  if (!videoId) return null;

  const frameClass = `yt-embed${className ? ` ${className}` : ''}`;

  if (playing) {
    const params = new URLSearchParams({ rel: '0', modestbranding: '1' });
    if (autoplay) params.set('autoplay', '1');
    return (
      <iframe
        className={frameClass}
        src={`https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`}
        title={title}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    );
  }

  return (
    <button
      type="button"
      className={`yt-facade${className ? ` ${className}` : ''}`}
      onClick={() => setPlaying(true)}
      aria-label={`Play ${title}`}
    >
      <img
        src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
      />
      <span className="yt-facade-play" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26">
          <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
        </svg>
      </span>
      <span className="yt-facade-label">YouTube</span>
    </button>
  );
};

export default YouTubeEmbed;
