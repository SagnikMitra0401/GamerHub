import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import axiosInstance from '../api/axiosInstance';
import PostForm from '../components/posts/PostForm';
import CommentForm from '../components/comments/CommentForm';
import CommentThread from '../components/comments/CommentThread';
import ConfirmModal from '../components/common/ConfirmModal';
import LinkPreviewCard from '../components/posts/LinkPreviewCard';

const PostDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const [post, setPost]         = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [comments, setComments] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [likeCount, setLikeCount] = useState(0);
  const [liked, setLiked]       = useState(false);
  const [likeLoading, setLikeLoading] = useState(false);
  // Auto-open edit mode when navigated with ?edit=1 (from PostCard edit button)
  const [editing, setEditing]   = useState(new URLSearchParams(location.search).get('edit') === '1');
  const [error, setError]       = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [{ data: p }, { data: c }] = await Promise.all([
          axiosInstance.get(`/posts/${id}`),
          axiosInstance.get(`/posts/${id}/comments`)
        ]);
        setPost(p);
        setComments(c);
        setLikeCount(p.likeCount ?? p.likes?.length ?? 0);
        setLiked(
          user
            ? p.likes?.some(uid =>
                uid === (user._id || user.id) ||
                uid?.toString() === (user._id || user.id)?.toString()
              )
            : false
        );
      } catch {
        setError('Post not found.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const handleLike = async () => {
    if (!user) return navigate('/login');
    if (likeLoading) return;
    setLikeLoading(true);
    try {
      const { data } = await axiosInstance.post(`/posts/${id}/like`);
      setLikeCount(data.likeCount);
      setLiked(data.liked);
    } catch {}
    finally { setLikeLoading(false); }
  };

  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    try {
      await axiosInstance.delete(`/posts/${id}`);
      navigate('/');
    } catch {}
    finally {
      setShowDeleteConfirm(false);
    }
  };

  const handleUpdated = updatedPost => {
    setPost(updatedPost);
    setEditing(false);
  };

  const handleCommentAdded = comment => {
    setComments(prev => [...prev, comment]);
    setPost(prev => ({ ...prev, commentCount: (prev.commentCount || 0) + 1 }));
  };

  const timeAgo = ts => {
    const s = Math.floor((Date.now() - new Date(ts)) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return new Date(ts).toLocaleDateString();
  };

  if (loading) return <div className="page"><div className="spinner" /></div>;

  if (error) return (
    <div className="page">
      <div className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
        <p className="text-muted">{error}</p>
        <button className="btn btn-ghost" style={{ marginTop: '1rem' }} onClick={() => navigate('/')}>
          ← Back to Feed
        </button>
      </div>
    </div>
  );

  // Normalise both sides to plain hex strings before comparing
  const normalId = v => (v?._id ?? v)?.toString?.() ?? '';
  const isOwner = !!user && normalId(post.userId) === normalId(user);
  const canEdit = isOwner && (Date.now() - new Date(post.createdAt).getTime()) < 5 * 60 * 1000;

  const initial = (post.userId?.username || 'U')[0].toUpperCase();

  return (
    <main className="page">
      <div className="container" style={{ paddingTop: '2rem', paddingBottom: '4rem' }}>

        <button className="post-detail-back" onClick={() => navigate('/')}>
          ← Back to Feed
        </button>

        {editing ? (
          <PostForm
            initialData={post}
            onSuccess={handleUpdated}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <article className="card">
            {/* Meta */}
            <div className="post-card-meta" style={{ marginBottom: '1rem' }}>
              <div className="post-avatar">{initial}</div>
              <span className="post-username">{post.userId?.username || 'Unknown'}</span>
              <span>·</span>
              <span>{timeAgo(post.createdAt)}</span>
            </div>

            {/* Title & Content */}
            <h1 className="post-detail-title">{post.title}</h1>

            {post.tags?.length > 0 && (
              <div className="post-tags">
                {post.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}
              </div>
            )}

            {post.content && <p className="post-detail-content">{post.content}</p>}

            {/* Media Rendering */}
            {post.mediaUrl && post.mediaType && post.mediaType !== 'none' && (
              <div 
                style={{ 
                  margin: '1.5rem 0', 
                  borderRadius: 'var(--radius-lg)', 
                  overflow: 'hidden', 
                  background: 'black', 
                  display: 'flex', 
                  justifyContent: 'center',
                  maxHeight: '500px',
                  border: '1px solid rgba(124, 58, 237, 0.15)'
                }}
              >
                {post.mediaType === 'video' ? (
                  <video
                    src={post.mediaUrl}
                    controls
                    autoPlay
                    muted
                    preload="auto"
                    style={{ width: '100%', maxHeight: '500px', objectFit: 'contain' }}
                  />
                ) : (
                  <img
                    src={post.mediaUrl}
                    alt={post.title}
                    style={{ width: '100%', maxHeight: '500px', objectFit: 'contain' }}
                  />
                )}
              </div>
            )}

            {/* Link Preview Rendering */}
            {post.linkPreview && post.linkPreview.url && (
              <div style={{ margin: '1.5rem 0' }}>
                <LinkPreviewCard preview={post.linkPreview} clickable={true} />
              </div>
            )}

            {/* Actions */}
            <div className="post-detail-actions">
              <button
                className={`like-btn ${liked ? 'liked' : ''}`}
                onClick={handleLike}
                disabled={likeLoading}
              >
                {liked ? '❤️' : '🤍'} {likeCount} {likeCount === 1 ? 'Like' : 'Likes'}
              </button>

              <span className="post-stat">💬 {post.commentCount ?? comments.length}</span>

              {isOwner && (
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
                  {canEdit && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                      Edit
                    </button>
                  )}
                  <button className="btn btn-danger btn-sm" onClick={handleDelete}>
                    Delete
                  </button>
                </div>
              )}
            </div>
          </article>
        )}

        {/* Comments */}
        <section className="comments-section">
          <h2 className="comments-title">
            💬 Discussion ({comments.length})
          </h2>
          <CommentForm postId={id} onCommentAdded={handleCommentAdded} />
          <CommentThread comments={comments} setComments={setComments} />
        </section>

      </div>

      <ConfirmModal
        isOpen={showDeleteConfirm}
        title="Delete Post"
        message="Are you sure you want to delete this post and all its comments? This action cannot be undone and will permanently remove associated files from cloud storage."
        confirmText="Delete"
        isDanger={true}
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </main>
  );
};

export default PostDetail;
