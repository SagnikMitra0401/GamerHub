import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { HeartIcon, CommentIcon } from '../common/icons';
import SafeImage from '../common/SafeImage';

const ClipCard = ({ post }) => {
  const navigate = useNavigate();
  const videoRef = useRef(null);

  const handleMouseEnter = () => {
    if (post.mediaType === 'video' && videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  };

  const handleMouseLeave = () => {
    if (post.mediaType === 'video' && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0; // reset
    }
  };

  const likesCount = post.likeCount ?? post.likes?.length ?? 0;

  return (
    <div
      className="clip-card"
      onClick={() => navigate(`/posts/${post._id}`)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Media Type Badge */}
      <span className="clip-card-badge">
        {post.mediaType === 'video' ? 'Clip' : 'Image'}
      </span>

      {/* Render element */}
      {post.mediaType === 'video' ? (
        <video
          ref={videoRef}
          src={post.mediaCardUrl || post.mediaUrl}
          muted
          loop
          playsInline
          preload="metadata"
          className="clip-card-media"
        />
      ) : (
        <SafeImage
          src={post.mediaCardUrl || post.mediaUrl}
          alt={post.title}
          loading="lazy"
          className="clip-card-media"
          fallback={<span className="clip-card-media media-missing">Image unavailable</span>}
        />
      )}

      {/* Hover Overlay with Stats */}
      <div className="clip-card-overlay">
        <span className="clip-card-stat"><HeartIcon size={13} /> {likesCount}</span>
        <span className="clip-card-stat"><CommentIcon size={13} /> {post.commentCount ?? 0}</span>
      </div>
    </div>
  );
};

export default ClipCard;
