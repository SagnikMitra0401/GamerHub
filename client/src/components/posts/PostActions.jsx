import React, { useState } from 'react';
import { HeartIcon, BookmarkIcon, CommentIcon } from '../common/icons';

// Six radial sparks. Angles are CSS custom properties so the burst is pure CSS.
const SPARKS = [0, 60, 120, 180, 240, 300];

// One-time capability read: coarse pointers and reduced-motion users skip the
// spark burst entirely, so a tap costs a colour change and a transform —
// nothing else.
const detectSparks = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Post reaction bar: spring heart, tactile bookmark and sonic comment pill.
 *
 * All motion is CSS keyframes on `transform` / `opacity`. The burst node
 * unmounts on `animationend`, so no timers, listeners or particle objects
 * survive the 400ms interaction.
 */
const PostActions = ({
  likeCount = 0,
  liked = false,
  onLike,
  likeBusy = false,
  commentCount = 0,
  onComment,
  saved = false,
  onSave,
  saveBusy = false
}) => {
  const [canSpark] = useState(detectSparks);
  const [popping, setPopping] = useState(false);
  const [bursting, setBursting] = useState(false);
  const [burstKey, setBurstKey] = useState(0);
  const [snapping, setSnapping] = useState(false);

  const handleLike = event => {
    if (!liked) {
      setPopping(true);
      if (canSpark) {
        setBurstKey(key => key + 1);
        setBursting(true);
      }
    }
    onLike?.(event);
  };

  const handleSave = event => {
    if (!saved) setSnapping(true);
    onSave?.(event);
  };

  return (
    <div className="post-actions" onClick={event => event.stopPropagation()}>
      <button
        type="button"
        className={`action-btn action-like ${liked ? 'is-on' : ''} ${popping ? 'is-popping' : ''}`}
        onClick={handleLike}
        disabled={likeBusy}
        aria-pressed={liked}
        aria-label={liked ? 'Unlike post' : 'Like post'}
        title={liked ? 'Unlike' : 'Like'}
      >
        <span className="action-icon-wrap">
          <HeartIcon
            className="action-icon icon-heart"
            size={17}
            onAnimationEnd={() => setPopping(false)}
          />
          {canSpark && bursting && (
            <span
              key={burstKey}
              className="action-sparks is-live"
              aria-hidden="true"
              onAnimationEnd={() => setBursting(false)}
            >
              {SPARKS.map(angle => (
                <i key={angle} style={{ '--a': `${angle}deg` }} />
              ))}
            </span>
          )}
        </span>
        <span className="action-count">{likeCount}</span>
      </button>

      <button
        type="button"
        className="action-btn action-comment"
        onClick={event => onComment?.(event)}
        aria-label={`View ${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}`}
        title="Comments"
      >
        <span className="action-icon-wrap">
          <CommentIcon className="action-icon" size={17} />
        </span>
        <span className="action-count">{commentCount}</span>
      </button>

      {onSave && (
        <button
          type="button"
          className={`action-btn action-save ${saved ? 'is-on' : ''} ${snapping ? 'is-snapping' : ''}`}
          onClick={handleSave}
          disabled={saveBusy}
          aria-pressed={saved}
          aria-label={saved ? 'Remove bookmark' : 'Bookmark post'}
          title={saved ? 'Remove bookmark' : 'Bookmark'}
        >
          <span className="action-icon-wrap">
            <BookmarkIcon
              className="action-icon icon-bookmark"
              size={17}
              onAnimationEnd={() => setSnapping(false)}
            />
          </span>
        </button>
      )}
    </div>
  );
};

export default PostActions;
