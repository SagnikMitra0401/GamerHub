import React from 'react';
import PostCard from './PostCard';

const PostList = ({ posts, onDelete, onLikeToggle }) => {
  const safePosts = Array.isArray(posts) ? posts : [];

  if (!safePosts.length) {
    return (
      <div className="post-list-empty">
        <h3>No posts yet</h3>
        <p>Be the first to start a discussion.</p>
      </div>
    );
  }

  return (
    <div className="post-list">
      {safePosts.map(post => (
        <PostCard
          key={post._id}
          post={post}
          onDelete={onDelete}
          onLikeToggle={onLikeToggle}
        />
      ))}
    </div>
  );
};

export default PostList;
