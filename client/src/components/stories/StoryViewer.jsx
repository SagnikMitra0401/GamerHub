import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import axiosInstance from '../../api/axiosInstance';
import SafeImage from '../common/SafeImage';
import { videoPosterUrl } from '../../utils/videoPoster';

const TEXT_MS = 5000;
const IMAGE_MS = 5000;

const timeAgo = (value) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
};

/**
 * Full-screen status viewer.
 *
 * Progress is segmented per author; text/image statuses advance on a timer,
 * video follows its own playback. Tapping the right side advances, the left
 * goes back, holding pauses, Escape closes.
 */
const StoryViewer = ({ groups = [], startGroup = 0, startStory = 0, onClose }) => {
  const [groupIndex, setGroupIndex] = useState(startGroup);
  const [storyIndex, setStoryIndex] = useState(startStory);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [viewers, setViewers] = useState(null);
  const [viewersLoading, setViewersLoading] = useState(false);
  const videoRef = useRef(null);
  const progressRef = useRef(0);
  const pressStartedAt = useRef(0);
  const suppressClick = useRef(false);

  const group = groups[groupIndex];
  const story = group?.stories?.[storyIndex];
  const isOwn = Boolean(group?.isOwn);

  useEffect(() => { progressRef.current = progress; }, [progress]);

  const goNext = useCallback(() => {
    setPaused(false);
    setViewers(null);
    setProgress(0);
    if (!groups.length) { onClose(); return; }
    const current = groups[groupIndex];
    if (current && storyIndex + 1 < current.stories.length) {
      setStoryIndex(storyIndex + 1);
      return;
    }
    if (groupIndex + 1 < groups.length) {
      setGroupIndex(groupIndex + 1);
      setStoryIndex(0);
      return;
    }
    onClose();
  }, [groups, groupIndex, storyIndex, onClose]);

  const goPrev = useCallback(() => {
    setPaused(false);
    setViewers(null);
    setProgress(0);
    if (storyIndex > 0) { setStoryIndex(storyIndex - 1); return; }
    if (groupIndex > 0) {
      const previous = groups[groupIndex - 1];
      setGroupIndex(groupIndex - 1);
      setStoryIndex(Math.max(0, previous.stories.length - 1));
    }
  }, [groups, groupIndex, storyIndex]);

  // Lock background scrolling while open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  // Keyboard control.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key === 'ArrowRight') { event.preventDefault(); goNext(); return; }
      if (event.key === 'ArrowLeft') { event.preventDefault(); goPrev(); return; }
      if (event.key === ' ') { event.preventDefault(); setPaused((value) => !value); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, onClose]);

  // Record a view once per story (the server dedupes by viewer).
  useEffect(() => {
    if (!story || isOwn) return;
    axiosInstance.post(`/stories/${story._id}/view`).catch(() => {});
  }, [story?._id, isOwn]);

  // Text/image timer. Video drives progress from its own timeupdate events.
  useEffect(() => {
    if (!story || story.kind === 'video' || paused) return undefined;
    const duration = story.kind === 'text' ? TEXT_MS : IMAGE_MS;
    const startedAt = Date.now() - (progressRef.current / 100) * duration;
    const tick = setInterval(() => {
      const percent = Math.min(100, ((Date.now() - startedAt) / duration) * 100);
      setProgress(percent);
      if (percent >= 100) {
        clearInterval(tick);
        goNext();
      }
    }, 50);
    return () => clearInterval(tick);
  }, [story?._id, story?.kind, paused, goNext]);

  // Video playback follows the pause state.
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    if (paused) element.pause();
    else element.play().catch(() => {});
  }, [paused, story?._id]);

  const loadViewers = async () => {
    if (!story) return;
    if (viewers) { setViewers(null); return; }
    setViewersLoading(true);
    try {
      const { data } = await axiosInstance.get(`/stories/${story._id}/viewers`);
      setViewers(Array.isArray(data?.viewers) ? data.viewers : []);
    } catch {
      setViewers([]);
    } finally {
      setViewersLoading(false);
    }
  };

  if (!story) return null;

  const backgroundClass = `story-bg-${story.background || 'aurora'}`;

  return (
    <div
      className={`story-viewer ${story.kind === 'text' ? backgroundClass : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${group.author.username}'s story`}
    >
      <div className={`story-viewer-stage ${story.kind === 'text' ? backgroundClass : ''}`}>
        <div className="story-viewer-bars">
          {group.stories.map((item, index) => (
            <span className="story-viewer-bar" key={item._id}>
              <span
                style={{
                  width: index < storyIndex ? '100%' : index === storyIndex ? `${progress}%` : '0%'
                }}
              />
            </span>
          ))}
        </div>

        <header className="story-viewer-head">
          <Link to={`/u/${group.author.username}`} className="story-viewer-author">
            <span className="story-ring avatar-initials" aria-hidden="true">
              {group.author.username?.[0]?.toUpperCase() || '?'}
            </span>
            <span>
              <strong>{group.author.username}</strong>
              <small>{timeAgo(story.createdAt)}</small>
            </span>
          </Link>
          <div className="story-viewer-head-actions">
            {isOwn && (
              <button type="button" className="story-chip" onClick={loadViewers} disabled={viewersLoading}>
                {viewersLoading ? 'Loading…' : `${story.viewCount || 0} views`}
              </button>
            )}
            <button type="button" className="story-close" onClick={onClose} aria-label="Close story">×</button>
          </div>
        </header>

        <div className="story-viewer-body">
          {story.kind === 'text' && <p className="story-viewer-text">{story.text}</p>}
          {story.kind === 'image' && (
            <SafeImage
              src={story.mediaUrl}
              alt={story.caption || `${group.author.username}'s story`}
              className="story-viewer-media"
            />
          )}
          {story.kind === 'video' && (
            <video
              ref={videoRef}
              src={story.mediaUrl}
              poster={videoPosterUrl(story.mediaUrl) || undefined}
              className="story-viewer-media"
              autoPlay
              playsInline
              muted={muted}
              onTimeUpdate={(event) => {
                const element = event.currentTarget;
                if (element.duration) setProgress((element.currentTime / element.duration) * 100);
              }}
              onEnded={goNext}
            />
          )}
          {story.caption && <p className="story-viewer-caption">{story.caption}</p>}
        </div>

        {/* Hold anywhere on the stage to pause; a short tap still navigates. */}
        <button
          type="button"
          className="story-nav-zone story-nav-prev"
          onClick={() => {
            if (suppressClick.current) { suppressClick.current = false; return; }
            goPrev();
          }}
          onPointerDown={() => { pressStartedAt.current = Date.now(); setPaused(true); }}
          onPointerUp={() => {
            suppressClick.current = Date.now() - pressStartedAt.current > 250;
            setPaused(false);
          }}
          onPointerLeave={() => setPaused(false)}
          aria-label="Previous story"
        />
        <button
          type="button"
          className="story-nav-zone story-nav-next"
          onClick={() => {
            if (suppressClick.current) { suppressClick.current = false; return; }
            goNext();
          }}
          onPointerDown={() => { pressStartedAt.current = Date.now(); setPaused(true); }}
          onPointerUp={() => {
            suppressClick.current = Date.now() - pressStartedAt.current > 250;
            setPaused(false);
          }}
          onPointerLeave={() => setPaused(false)}
          aria-label="Next story"
        />

        {story.kind === 'video' && (
          <button
            type="button"
            className="story-chip story-mute"
            onClick={() => setMuted((value) => !value)}
            aria-pressed={!muted}
          >
            {muted ? 'Unmute' : 'Mute'}
          </button>
        )}
      </div>

      {viewers && (
        <aside className="story-viewers" aria-label="Who viewed this story">
          <header>
            <h4>Viewed by</h4>
            <button type="button" className="story-close" onClick={() => setViewers(null)} aria-label="Close viewer list">×</button>
          </header>
          {viewers.length === 0 ? (
            <p className="story-viewers-empty">No views yet.</p>
          ) : (
            <ul>
              {viewers.map((viewer) => (
                <li key={viewer._id}>
                  <Link to={`/u/${viewer.username}`}>{viewer.username}</Link>
                  <small>{timeAgo(viewer.viewedAt)}</small>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </div>
  );
};

export default StoryViewer;
