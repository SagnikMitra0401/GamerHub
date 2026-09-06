import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import axiosInstance from '../../api/axiosInstance';
import ConfirmModal from '../common/ConfirmModal';

const PostCard = ({ post, onDelete, onLikeToggle }) => {
  const { user, updateSavedPosts } = useAuth();
  const navigate = useNavigate();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [likeCount, setLikeCount] = useState(post.likeCount ?? post.likes?.length ?? 0);
  const [liked, setLiked] = useState(
    post.likes?.some(id => id === user?._id || id?.toString?.() === user?._id?.toString?.())
  );
  const [likeLoading, setLikeLoading] = useState(false);
  const [saved, setSaved] = useState(
    user?.savedPosts?.some(id => id === post._id || id?.toString?.() === post._id?.toString?.())
  );
  const [saveLoading, setSaveLoading] = useState(false);

  // Normalise both sides to plain hex strings before comparing
  const normalId = v => (v?._id ?? v)?.toString?.() ?? '';
  const isOwner = !!user && normalId(post.userId) === normalId(user);
  const isStaff = user?.role === 'admin' || user?.role === 'moderator';
  const canEdit = isOwner && (Date.now() - new Date(post.createdAt).getTime()) < 5 * 60 * 1000;
  const canDelete = isOwner || isStaff;

  const handleLike = async e => {
    e.stopPropagation();
    if (!user) return navigate('/login');
    if (likeLoading) return;
    setLikeLoading(true);
    try {
      const { data } = await axiosInstance.post(`/posts/${post._id}/like`);
      setLikeCount(data.likeCount);
      setLiked(data.liked);
      onLikeToggle?.(post._id, data);
    } catch {}
    finally { setLikeLoading(false); }
  };

  const handleSave = async e => {
    e.stopPropagation();
    if (!user) return navigate('/login');
    if (saveLoading) return;
    setSaveLoading(true);
    try {
      const { data } = await axiosInstance.post(`/users/saved/${post._id}`);
      setSaved(data.saved);
      updateSavedPosts(post._id, data.saved);
    } catch {}
    finally { setSaveLoading(false); }
  };

  const handleDelete = e => {
    e.stopPropagation();
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    try {
      await axiosInstance.delete(`/posts/${post._id}`);
      onDelete?.(post._id);
    } catch {}
    finally {
      setShowDeleteConfirm(false);
    }
  };

  const handleTagClick = (e, tag) => {
    e.stopPropagation();
    navigate(`/c/${encodeURIComponent(tag)}`);
  };

  const initial = (post.userId?.username || 'U')[0].toUpperCase();
  const timeAgo = ts => {
    const s = Math.floor((Date.now() - new Date(ts)) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return `${Math.floor(s/86400)}d ago`;
  };

  return (
    <article className="post-card" onClick={() => navigate(`/posts/${post._id}`)}>
      <div className="post-card-meta">
        <div
          className="post-avatar"
          onClick={e => { e.stopPropagation(); navigate(`/u/${post.userId?.username}`); }}
          style={{ cursor: 'pointer' }}
          title={`View ${post.userId?.username}'s profile`}
        >
          {initial}
        </div>
        <span
          className="post-username"
          onClick={e => { e.stopPropagation(); navigate(`/u/${post.userId?.username}`); }}
          style={{ cursor: 'pointer' }}
        >
          {post.userId?.username || 'Unknown'}
        </span>

        {/* Level & Role Badges */}
        <span className="level-badge" title={`Player Level ${post.userId?.level || 1}`}>
          Lv{post.userId?.level || 1}
        </span>
        {post.userId?.role === 'admin' && <span className="role-badge admin">👑 Admin</span>}
        {post.userId?.role === 'moderator' && <span className="role-badge mod">🛡️ Mod</span>}

        <span>·</span>
        <span>{timeAgo(post.createdAt)}</span>
      </div>

      <h2 className="post-card-title">{post.title}</h2>
      {post.content && <p className="post-card-content">{post.content}</p>}

      {/* Media Rendering */}
      {post.mediaUrl && post.mediaType && post.mediaType !== 'none' && (
        <div 
          style={{ 
            marginBottom: '1rem', 
            borderRadius: 'var(--radius-md)', 
            overflow: 'hidden', 
            background: 'black', 
            display: 'flex', 
            justifyContent: 'center',
            maxHeight: '380px',
            border: '1px solid rgba(124, 58, 237, 0.1)'
          }}
          onClick={e => e.stopPropagation()} // Prevent clicking video from triggering card click
        >
          {post.mediaType === 'video' ? (
            <video
              src={post.mediaUrl}
              controls
              preload="metadata"
              style={{ width: '100%', maxHeight: '380px', objectFit: 'contain' }}
            />
          ) : (
            <img
              src={post.mediaUrl}
              alt={post.title}
              loading="lazy"
              style={{ width: '100%', maxHeight: '380px', objectFit: 'contain' }}
            />
          )}
        </div>
      )}

      {/* Link Preview Rendering */}
      {post.linkPreview && post.linkPreview.url && (
        <a
          href={post.linkPreview.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{
            display: 'flex',
            marginBottom: '1rem',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            border: '1px solid var(--border)',
            background: 'var(--bg-surface)',
            color: 'inherit',
            transition: 'background var(--transition), border-color var(--transition)'
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--bg-elevated)';
            e.currentTarget.style.borderColor = 'var(--border-hover)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'var(--bg-surface)';
            e.currentTarget.style.borderColor = 'var(--border)';
          }}
        >
          {post.linkPreview.image && (
            <div style={{ width: '120px', minWidth: '120px', height: '120px', overflow: 'hidden', background: '#000' }}>
              <img 
                src={post.linkPreview.image} 
                alt={post.linkPreview.title} 
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
              />
            </div>
          )}
          <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden' }}>
            <h4 style={{ fontSize: '0.92rem', fontWeight: 700, margin: '0 0 0.25rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {post.linkPreview.title || 'Link Preview'}
            </h4>
            {post.linkPreview.description && (
              <p className="text-muted" style={{ fontSize: '0.78rem', margin: '0 0 0.35rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: '1.4' }}>
                {post.linkPreview.description}
              </p>
            )}
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--primary-light)', textTransform: 'lowercase' }}>
              🔗 {(() => {
                try {
                  return new URL(post.linkPreview.url).hostname;
                } catch {
                  return 'link';
                }
              })()}
            </span>
          </div>
        </a>
      )}

      {post.tags?.length > 0 && (
        <div className="post-tags">
          {post.tags.map(tag => (
            <span
              key={tag}
              className="tag"
              style={{ cursor: 'pointer' }}
              onClick={e => handleTagClick(e, tag)}
              title={`Browse #${tag}`}
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      <div className="post-card-footer">
        <button
          className={`like-btn ${liked ? 'liked' : ''}`}
          onClick={handleLike}
          disabled={likeLoading}
          title={liked ? 'Unlike' : 'Like'}
        >
          {liked ? '❤️' : '🤍'} {likeCount}
        </button>

        <span className="post-stat">💬 {post.commentCount ?? 0}</span>

        <button
          className={`like-btn ${saved ? 'liked' : ''}`}
          onClick={handleSave}
          disabled={saveLoading}
          title={saved ? 'Remove bookmark' : 'Bookmark'}
          style={{ marginLeft: '0.25rem' }}
        >
          {saved ? '🔖' : '📑'}
        </button>

        {(canDelete || (isOwner && canEdit)) && (
          <div className="post-card-owner-actions" onClick={e => e.stopPropagation()}>
            {isOwner && canEdit && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={e => { e.stopPropagation(); navigate(`/posts/${post._id}?edit=1`); }}
                title="Edit post (available for 5 min after posting)"
              >
                ✏️ Edit
              </button>
            )}
            {canDelete && (
              <button 
                className="btn btn-ghost btn-sm btn-danger" 
                onClick={handleDelete}
                title={isOwner ? 'Delete your post' : 'Moderate/Delete this post'}
              >
                🗑️ Delete
              </button>
            )}
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={showDeleteConfirm}
        title="Delete Post"
        message="Are you sure you want to delete this post? This action cannot be undone and will permanently remove the associated media from cloud storage."
        confirmText="Delete"
        isDanger={true}
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </article>
  );
};

export default PostCard;
