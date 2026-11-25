import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import axiosInstance from '../../api/axiosInstance';
import ConfirmModal from '../common/ConfirmModal';

const CommentThread = ({ comments, setComments }) => {
  const { user } = useAuth();
  const [deletingComment, setDeletingComment] = useState(null); // { id, postId } | null

  const handleConfirmDelete = async () => {
    if (!deletingComment) return;
    const { id, postId } = deletingComment;
    try {
      await axiosInstance.delete(`/posts/${postId}/comments/${id}`);
      setComments((prev) => prev.filter((c) => c._id !== id));
    } catch {
    } finally {
      setDeletingComment(null);
    }
  };

  const timeAgo = (ts) => {
    const s = Math.floor((Date.now() - new Date(ts)) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };

  if (!comments?.length) {
    return (
      <p className="text-muted" style={{ padding: '1rem 0' }}>
        No comments yet — be the first to reply!
      </p>
    );
  }

  return (
    <div>
      {comments.map((comment) => {
        const isOwner =
          user &&
          (comment.userId?._id || comment.userId)?.toString() === (user._id || user.id)?.toString();

        const initial = (comment.userId?.username || 'U')[0].toUpperCase();

        return (
          <div key={comment._id} className="comment">
            <div className="post-avatar">{initial}</div>
            <div className="comment-body">
              <div className="comment-meta">
                <span className="comment-username">{comment.userId?.username || 'Unknown'}</span>
                <span className="comment-date">· {timeAgo(comment.createdAt)}</span>
                {isOwner && (
                  <button
                    className="btn btn-sm btn-danger"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => setDeletingComment({ id: comment._id, postId: comment.postId })}
                  >
                    Delete
                  </button>
                )}
              </div>
              <p className="comment-text">{comment.text}</p>
            </div>
          </div>
        );
      })}

      <ConfirmModal
        isOpen={!!deletingComment}
        title="Delete Comment"
        message="Are you sure you want to delete this comment? This action cannot be undone."
        confirmText="Delete"
        isDanger={true}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeletingComment(null)}
      />
    </div>
  );
};

export default CommentThread;
