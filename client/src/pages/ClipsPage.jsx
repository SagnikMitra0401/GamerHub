import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';
import { HeartIcon, CommentIcon, BookmarkIcon } from '../components/common/icons';
import { videoPosterUrl } from '../utils/videoPoster';

const PAGE_SIZE = 8;

const prefersReducedMotion = () => (
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
);

/**
 * Reels: one autoplaying clip per viewport.
 *
 * Only the visible slide plays, the next clip is preloaded, and everything
 * pauses as soon as the page loses focus or the route changes — three phones
 * left open on this page must not turn into three video decoders.
 */
const ClipsPage = () => {
  const { user, updateSavedPosts } = useAuth();
  const navigate = useNavigate();
  const [clips, setClips] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  // Reduced motion starts paused: nothing plays until the viewer asks.
  const [paused, setPaused] = useState(prefersReducedMotion);
  const [progress, setProgress] = useState(0);
  const [reactions, setReactions] = useState({});
  const reducedMotion = useRef(prefersReducedMotion());

  const feedRef = useRef(null);
  const slideRefs = useRef([]);
  const videoRefs = useRef([]);

  const load = useCallback(async (nextPage = 1) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await axiosInstance.get('/posts', {
        params: { mediaType: 'video', sort: 'latest', page: nextPage, limit: PAGE_SIZE }
      });
      const list = Array.isArray(data) ? data : [];
      setClips((prev) => (nextPage === 1 ? list : [...prev, ...list]));
      setHasMore(list.length === PAGE_SIZE);
      setPage(nextPage);
    } catch {
      setError('Clips could not be loaded. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(1); }, [load]);

  // Server-derived reaction state, with this session's optimistic responses on
  // top. Deriving it during render means a late `fetchMe` (which supplies
  // savedPosts) is reflected instead of frozen at the signed-out defaults.
  const reactionFor = (clip) => ({
    likeCount: clip.likeCount ?? clip.likes?.length ?? 0,
    liked: Boolean(user && (clip.likes || []).some((id) => String(id) === String(user._id))),
    saved: Boolean(user?.savedPosts?.some((id) => String(id) === String(clip._id))),
    ...(reactions[clip._id] || {})
  });

  // A new clip starts at 0% instead of inheriting the previous clip's bar.
  useEffect(() => { setProgress(0); }, [activeIndex]);

  // Play only the visible clip.
  useEffect(() => {
    videoRefs.current.forEach((video, index) => {
      if (!video) return;
      if (index === activeIndex && !paused) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    });
  }, [activeIndex, paused, clips.length]);

  useEffect(() => {
    const container = feedRef.current;
    if (!container) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const index = Number(entry.target.dataset.index);
            if (Number.isFinite(index)) {
              setActiveIndex(index);
              // Scrolling never auto-plays when the viewer asked for less motion.
              setPaused(reducedMotion.current);
            }
          }
        });
      },
      { root: container, threshold: [0.6] }
    );
    slideRefs.current.forEach((slide) => slide && observer.observe(slide));
    return () => observer.disconnect();
  }, [clips.length]);

  // Pause when the tab is hidden or the window loses focus, and resume only the
  // active clip when it comes back (unless the viewer paused it themselves).
  useEffect(() => {
    const pauseAll = () => videoRefs.current.forEach((video) => video && video.pause());
    const resumeActive = () => {
      if (paused) return;
      videoRefs.current[activeIndex]?.play().catch(() => {});
    };
    const onVisibility = () => {
      if (document.hidden) pauseAll();
      else resumeActive();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', pauseAll);
    window.addEventListener('focus', resumeActive);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', pauseAll);
      window.removeEventListener('focus', resumeActive);
    };
  }, [activeIndex, paused]);

  useEffect(() => () => {
    videoRefs.current.forEach((video) => video && video.pause());
  }, []);

  const scrollToIndex = (index) => {
    const target = slideRefs.current[index];
    const container = feedRef.current;
    if (!target || !container) return;
    // Scroll the feed itself, not every scrollable ancestor: `scrollIntoView`
    // also moved the page around the reel.
    const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTo({ top, behavior: reducedMotion.current ? 'auto' : 'smooth' });
    setActiveIndex(index);
    setPaused(reducedMotion.current);
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      scrollToIndex(Math.min(activeIndex + 1, clips.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      scrollToIndex(Math.max(activeIndex - 1, 0));
    } else if (event.key === ' ') {
      event.preventDefault();
      setPaused((value) => !value);
    } else if (event.key.toLowerCase() === 'm') {
      event.preventDefault();
      setMuted((value) => !value);
    }
  };

  const react = (clip, kind) => {
    if (!user) {
      navigate('/login');
      return;
    }
    if (kind === 'like') {
      axiosInstance.post(`/posts/${clip._id}/like`).then(({ data }) => {
        setReactions((prev) => ({ ...prev, [clip._id]: { ...prev[clip._id], liked: data.liked, likeCount: data.likeCount } }));
      }).catch(() => {});
      return;
    }
    axiosInstance.post(`/users/saved/${clip._id}`).then(({ data }) => {
      setReactions((prev) => ({ ...prev, [clip._id]: { ...prev[clip._id], saved: data.saved } }));
      updateSavedPosts(clip._id, data.saved);
    }).catch(() => {});
  };

  if (loading && clips.length === 0) {
    return (
      <main className="page clips-page">
        <div className="clips-loading" role="status">Loading clips…</div>
      </main>
    );
  }

  return (
    <main className="page clips-page">
      <div
        className="clips-feed"
        ref={feedRef}
        tabIndex={0}
        role="region"
        aria-label="Clips"
        onKeyDown={onKeyDown}
      >
        {clips.length === 0 ? (
          <div className="clips-empty">
            <h1>No clips yet</h1>
            <p>Upload a video post and it will show up here.</p>
            <Link to="/" className="btn btn-primary">Go to the feed</Link>
          </div>
        ) : (
          clips.map((clip, index) => {
            const reaction = reactionFor(clip);
            return (
              <section
                key={clip._id}
                className="clip-slide"
                data-index={index}
                ref={(node) => { slideRefs.current[index] = node; }}
                aria-label={clip.title}
              >
                <video
                  ref={(node) => { videoRefs.current[index] = node; }}
                  className="clip-slide-video"
                  src={clip.mediaUrl}
                  poster={videoPosterUrl(clip.mediaUrl) || undefined}
                  muted={muted}
                  loop
                  playsInline
                  preload={index <= activeIndex + 1 ? 'auto' : 'metadata'}
                  onClick={() => setPaused((value) => (index === activeIndex ? !value : false))}
                  onTimeUpdate={(event) => {
                    if (index !== activeIndex) return;
                    const video = event.currentTarget;
                    setProgress(video.duration ? video.currentTime / video.duration : 0);
                  }}
                />

                <div className="clip-slide-progress" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
                </div>

                {paused && index === activeIndex && (
                  <button type="button" className="clip-slide-play" onClick={() => setPaused(false)} aria-label="Play clip">
                    <svg viewBox="0 0 24 24" width="34" height="34"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
                  </button>
                )}

                <div className="clip-slide-overlay">
                  <Link to={`/u/${clip.userId?.username || ''}`} className="clip-slide-author">
                    @{clip.userId?.username || 'unknown'}
                  </Link>
                  <h2 className="clip-slide-title">{clip.title}</h2>
                  {clip.content && <p className="clip-slide-caption">{clip.content}</p>}
                  <div className="clip-slide-tags">
                    {(clip.tags || []).slice(0, 3).map((tag) => (
                      <Link key={tag} to={`/c/${encodeURIComponent(tag)}`} className="tag">#{tag}</Link>
                    ))}
                  </div>
                </div>

                <div className="clip-slide-actions">
                  <button
                    type="button"
                    className="clip-action"
                    onClick={() => react(clip, 'like')}
                    aria-pressed={!!reaction.liked}
                    aria-label={reaction.liked ? 'Unlike clip' : 'Like clip'}
                  >
                    <HeartIcon size={22} />
                    <span>{reaction.likeCount}</span>
                  </button>
                  <button
                    type="button"
                    className="clip-action"
                    onClick={() => navigate(`/posts/${clip._id}#comments`)}
                    aria-label="View comments"
                  >
                    <CommentIcon size={22} />
                    <span>{clip.commentCount ?? 0}</span>
                  </button>
                  <button
                    type="button"
                    className="clip-action"
                    onClick={() => react(clip, 'save')}
                    aria-pressed={!!reaction.saved}
                    aria-label={reaction.saved ? 'Remove bookmark' : 'Save clip'}
                  >
                    <BookmarkIcon size={22} />
                    <span>Save</span>
                  </button>
                  <button type="button" className="clip-action" onClick={() => setMuted((value) => !value)} aria-label={muted ? 'Unmute' : 'Mute'}>
                    <span className="clip-action-glyph" aria-hidden="true">{muted ? 'M+' : 'M−'}</span>
                    <span>{muted ? 'Sound' : 'Muted'}</span>
                  </button>
                  <Link to={`/watch/${clip._id}`} className="clip-action clip-action-link">Open</Link>
                </div>
              </section>
            );
          })
        )}
      </div>

      {error && <p className="clips-error" role="alert">{error}</p>}

      {clips.length > 0 && hasMore && (
        <div className="clips-more">
          <button type="button" className="btn btn-ghost btn-sm" disabled={loading} onClick={() => load(page + 1)}>
            {loading ? 'Loading…' : 'Load more clips'}
          </button>
        </div>
      )}
    </main>
  );
};

export default ClipsPage;
