import React from 'react';
import { useNavigate } from 'react-router-dom';
import SafeImage from '../common/SafeImage';
import { videoPosterUrl } from '../../utils/videoPoster';
import { HeartIcon, CommentIcon } from '../common/icons';

/**
 * A fixed-shape post card for grid layouts.
 *
 * The list view is for reading; this view is for scanning. Every tile reserves
 * the same media box (4:5), the same two title lines, the same two excerpt
 * lines and the same footer, so a row never looks ragged because one author
 * wrote a longer title or uploaded a taller image.
 */

const hueFor = (value = '') => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 360;
  }
  return hash;
};

const PostTile = ({ post }) => {
  const navigate = useNavigate();
  const open = () => navigate(`/posts/${post._id}`);
  const onKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  };

  const hasMedia = Boolean(post.mediaUrl) && post.mediaType && post.mediaType !== 'none';
  const isVideo = post.mediaType === 'video';
  const likeCount = post.likeCount ?? post.likes?.length ?? 0;
  const author = post.userId?.username || 'Unknown';

  return (
    <article
      className="post-tile glow-card"
      role="link"
      tabIndex={0}
      aria-label={`Open post: ${post.title}`}
      onClick={open}
      onKeyDown={onKeyDown}
    >
      <div className="post-tile-media">
        {hasMedia ? (
          isVideo ? (
            <>
              <video
                src={post.mediaUrl}
                poster={videoPosterUrl(post.mediaUrl) || undefined}
                muted
                playsInline
                preload="metadata"
                className="post-tile-media-el"
              />
              <span className="post-tile-play" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
                </svg>
              </span>
              {post.durationSeconds ? (
                <span className="post-tile-duration">{formatDuration(post.durationSeconds)}</span>
              ) : null}
            </>
          ) : (
            <SafeImage
              src={post.mediaCardUrl || post.mediaUrl}
              alt=""
              loading="lazy"
              className="post-tile-media-el"
              fallback={<span className="post-tile-media-el media-missing">Image unavailable</span>}
            />
          )
        ) : (
          <div
            className="post-tile-text"
            style={{
              background: `linear-gradient(145deg, hsl(${hueFor(post._id)} 55% 22%), hsl(${(hueFor(post._id) + 40) % 360} 45% 12%))`,
            }}
          >
            <span>{post.title}</span>
          </div>
        )}
      </div>

      <div className="post-tile-body">
        <h3 className="post-tile-title">{post.title}</h3>
        <p className="post-tile-excerpt">{post.content || 'No description'}</p>
        {post.tags?.length > 0 && (
          <div className="post-tile-tags">
            {post.tags.slice(0, 2).map((tag) => (
              <span key={tag} className="tag">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="post-tile-footer">
        <span className="post-tile-author">@{author}</span>
        <span className="post-tile-stats">
          <span>
            <HeartIcon size={13} /> {likeCount}
          </span>
          <span>
            <CommentIcon size={13} /> {post.commentCount ?? 0}
          </span>
        </span>
      </div>
    </article>
  );
};

const formatDuration = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
};

export default PostTile;
