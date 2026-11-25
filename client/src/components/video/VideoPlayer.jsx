import React, { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_PREFIX = 'gh-video:';

/**
 * Shared long-form player.
 *
 * Native controls stay in charge of the basics; this wrapper adds resumable
 * playback, a speed control, picture-in-picture and fullscreen, plus keyboard
 * shortcuts that only fire while the player itself has focus (so typing in a
 * comment box never pauses a video).
 */
const VideoPlayer = ({ src, poster = null, title = 'Video', resumeKey, className = '' }) => {
  const videoRef = useRef(null);
  const lastSaved = useRef(0);
  const [rate, setRate] = useState(1);
  const [pipActive, setPipActive] = useState(false);
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const [notice, setNotice] = useState('');

  const storageKey = resumeKey ? `${STORAGE_PREFIX}${resumeKey}` : null;

  const savePosition = useCallback(() => {
    if (!storageKey || !videoRef.current) return;
    const { currentTime, duration } = videoRef.current;
    if (!Number.isFinite(duration) || duration <= 0) return;
    try {
      window.localStorage.setItem(
        storageKey,
        String(Math.min(currentTime, Math.max(0, duration - 3))),
      );
    } catch {
      // Private mode or a full quota must never break playback.
    }
  }, [storageKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !storageKey) return undefined;

    const onLoaded = () => {
      let saved = 0;
      try {
        saved = Number(window.localStorage.getItem(storageKey)) || 0;
      } catch {
        saved = 0;
      }
      // Short clips (reels are ≤ 90 s) need a small guard, not a five-second
      // one: a 10 s video would otherwise never resume anywhere.
      if (Number.isFinite(saved) && saved > 1 && saved < video.duration - 1) {
        video.currentTime = saved;
      }
    };

    // Metadata may already be there (cache, fast network) before this effect
    // runs; in that case `loadedmetadata` has already fired and waiting would
    // silently lose the resume position.
    if (video.readyState >= 1) onLoaded();
    video.addEventListener('loadedmetadata', onLoaded);
    return () => video.removeEventListener('loadedmetadata', onLoaded);
  }, [storageKey]);

  useEffect(() => () => savePosition(), [savePosition]);

  // A paused seek never fires `pause` or `timeupdate`, and a reload does not
  // unmount React. Persist on both so short clips resume where the viewer
  // actually left them.
  useEffect(() => {
    const onPageHide = () => savePosition();
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [savePosition]);

  // Mirror the browser's own picture-in-picture / fullscreen state so the
  // buttons report what really happened instead of only existing.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const onEnterPip = () => setPipActive(true);
    const onLeavePip = () => setPipActive(false);
    const onFullscreen = () => setFullscreenActive(Boolean(document.fullscreenElement));

    video.addEventListener('enterpictureinpicture', onEnterPip);
    video.addEventListener('leavepictureinpicture', onLeavePip);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      video.removeEventListener('enterpictureinpicture', onEnterPip);
      video.removeEventListener('leavepictureinpicture', onLeavePip);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, []);

  const onTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    const now = video.currentTime;
    if (Math.abs(now - lastSaved.current) < 5) return;
    lastSaved.current = now;
    savePosition();
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  };

  const seek = (delta) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(Math.max(video.currentTime + delta, 0), video.duration || 0);
  };

  const toggleFullscreen = async () => {
    const container = videoRef.current?.parentElement;
    if (!container) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen?.();
      else await container.requestFullscreen?.();
      setNotice('');
    } catch {
      setNotice('Fullscreen is not available in this browser.');
    }
  };

  const togglePictureInPicture = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture?.();
      else await video.requestPictureInPicture?.();
      setNotice('');
    } catch {
      setNotice('Picture-in-picture is not available in this browser.');
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (video) video.muted = !video.muted;
  };

  const onKeyDown = (event) => {
    if (event.target !== event.currentTarget) return;
    const key = event.key;
    if (key === ' ' || key === 'k') {
      event.preventDefault();
      togglePlay();
    } else if (key === 'ArrowRight') {
      event.preventDefault();
      seek(5);
    } else if (key === 'ArrowLeft') {
      event.preventDefault();
      seek(-5);
    } else if (key.toLowerCase() === 'f') {
      event.preventDefault();
      toggleFullscreen();
    } else if (key.toLowerCase() === 'm') {
      event.preventDefault();
      toggleMute();
    }
  };

  const changeRate = (value) => {
    const next = Number(value);
    setRate(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  };

  return (
    <div
      className={`video-player${className ? ` ${className}` : ''}`}
      tabIndex={0}
      role="group"
      aria-label={`${title} player`}
      onKeyDown={onKeyDown}
    >
      <video
        ref={videoRef}
        className="video-player-el"
        src={src}
        poster={poster || undefined}
        controls
        playsInline
        preload="metadata"
        onTimeUpdate={onTimeUpdate}
        onPause={savePosition}
        onSeeked={savePosition}
      />

      <div className="video-player-tools">
        <label className="video-player-rate">
          <span className="sr-only">Playback speed</span>
          <select
            value={rate}
            onChange={(event) => changeRate(event.target.value)}
            aria-label="Playback speed"
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="video-player-btn"
          onClick={togglePictureInPicture}
          aria-pressed={pipActive}
          title="Picture in picture"
        >
          PiP
        </button>
        <button
          type="button"
          className="video-player-btn"
          onClick={toggleFullscreen}
          aria-pressed={fullscreenActive}
          title="Fullscreen"
        >
          Fullscreen
        </button>
        {notice && (
          <span className="video-player-notice" role="status">
            {notice}
          </span>
        )}
      </div>
      <p className="video-player-hint">
        Space play/pause · Left/Right seek · F fullscreen · M mute
      </p>
    </div>
  );
};

export default VideoPlayer;
