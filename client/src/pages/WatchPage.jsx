import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import VideoPlayer from '../components/video/VideoPlayer';
import YouTubeEmbed from '../components/video/YouTubeEmbed';
import PostTile from '../components/posts/PostTile';
import { videoPosterUrl } from '../utils/videoPoster';

/**
 * Long-form watch page.
 *
 * Uploaded videos get the shared player (resume, speed, PiP, fullscreen);
 * YouTube links get the click-to-load facade and are never downloaded. The
 * next-up rail prefers posts sharing the first tag, then falls back to the
 * latest media posts so the page is never a dead end.
 */
const WatchPage = () => {
  const { id } = useParams();
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nextUp, setNextUp] = useState([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    axiosInstance
      .get(`/posts/${id}`)
      .then(({ data }) => {
        if (!cancelled) setPost(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err.response?.status === 404
            ? 'This video is no longer available.'
            : 'The video could not be loaded.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!post) return undefined;
    let cancelled = false;
    const tag = post.tags?.[0];
    const params = { limit: 9, sort: 'trending' };
    if (tag) params.channel = tag;

    axiosInstance
      .get('/posts', { params })
      .then(({ data }) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setNextUp(list.filter((entry) => entry._id !== post._id).slice(0, 6));
      })
      .catch(() => {
        if (!cancelled) setNextUp([]);
      });

    return () => {
      cancelled = true;
    };
  }, [post]);

  if (loading) {
    return (
      <main className="page watch-page">
        <div className="container">
          <div className="watch-player-skeleton" role="status">
            Loading video…
          </div>
        </div>
      </main>
    );
  }

  if (error || !post) {
    return (
      <main className="page watch-page">
        <div className="container">
          <div className="post-list-empty">
            <h3>{error || 'Video not found'}</h3>
            <p>It may have been deleted by its author or by moderation.</p>
            <Link to="/clips" className="btn btn-primary">
              Browse clips
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const isUpload = post.mediaType === 'video' && post.mediaUrl;
  const isYouTube = !isUpload && post.youtubeId;

  return (
    <main className="page watch-page">
      <div className="container watch-layout">
        <div className="watch-main">
          <div className="watch-stage">
            {isUpload ? (
              <VideoPlayer
                src={post.mediaUrl}
                poster={videoPosterUrl(post.mediaUrl, 1280)}
                title={post.title}
                resumeKey={post._id}
                className="watch-player"
              />
            ) : isYouTube ? (
              <div className="watch-youtube">
                <YouTubeEmbed videoId={post.youtubeId} title={post.title} />
              </div>
            ) : (
              <div className="watch-empty">
                <p>This post has no playable video.</p>
                <Link to={`/posts/${post._id}`} className="btn btn-ghost btn-sm">
                  Open the post
                </Link>
              </div>
            )}
          </div>

          <h1 className="watch-title">{post.title}</h1>
          <div className="watch-meta">
            <Link to={`/u/${post.userId?.username || ''}`} className="watch-author">
              @{post.userId?.username || 'unknown'}
            </Link>
            {post.durationSeconds ? <span>{formatDuration(post.durationSeconds)}</span> : null}
            {isYouTube ? <span>YouTube</span> : <span>Uploaded clip</span>}
          </div>

          {post.content && <p className="watch-description">{post.content}</p>}

          <div className="watch-links">
            {post.tags?.slice(0, 4).map((tag) => (
              <Link key={tag} to={`/c/${encodeURIComponent(tag)}`} className="tag">
                #{tag}
              </Link>
            ))}
            <Link to={`/posts/${post._id}`} className="btn btn-ghost btn-sm">
              Comments &amp; likes
            </Link>
          </div>
        </div>

        <aside className="watch-side" aria-label="Next up">
          <h2 className="watch-side-title">Next up</h2>
          {nextUp.length === 0 ? (
            <p className="text-muted">Nothing else here yet.</p>
          ) : (
            <div className="watch-next-grid">
              {nextUp.map((item) => (
                <PostTile key={item._id} post={item} />
              ))}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
};

const formatDuration = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
};

export default WatchPage;
