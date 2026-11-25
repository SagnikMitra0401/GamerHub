import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import axiosInstance from '../../api/axiosInstance';

const CommentForm = ({ postId, onCommentAdded }) => {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!user) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setError('');
    setLoading(true);
    try {
      const { data } = await axiosInstance.post(`/posts/${postId}/comments`, { text });
      onCommentAdded?.(data);
      setText('');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not post comment.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: '1.5rem' }}>
      {error && <div className="form-error">{error}</div>}
      <div className="comment-form">
        <div className="post-avatar" style={{ marginTop: '0.2rem' }}>
          {user.username[0].toUpperCase()}
        </div>
        <input
          id="comment-input"
          className="form-input"
          placeholder="Add a comment..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          required
        />
        <button id="comment-submit" className="btn btn-primary" disabled={loading || !text.trim()}>
          {loading ? '...' : 'Post'}
        </button>
      </div>
    </form>
  );
};

export default CommentForm;
