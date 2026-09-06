import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import axiosInstance from '../api/axiosInstance';
import PostList from '../components/posts/PostList';
import PostForm from '../components/posts/PostForm';
import ClipCard from '../components/posts/ClipCard';

const SORT_OPTIONS = [
  { key: 'latest',     label: '🕐 Latest' },
  { key: 'most_liked', label: '🔥 Top' }
];

const Feed = () => {
  const { user, fetchMe } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [posts, setPosts]       = useState([]);
  const [sort, setSort]         = useState('latest');
  const [feedMode, setFeedMode] = useState('global'); // 'global' | 'following'
  const [layout, setLayout]     = useState('list');   // 'list' | 'clips'
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [page, setPage]         = useState(1);
  const [hasMore, setHasMore]   = useState(true);
  const LIMIT = 15;

  // Auto-open form if navigated with ?create=1
  useEffect(() => {
    if (searchParams.get('create') === '1') {
      setShowForm(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      // clean up query param
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const fetchPosts = useCallback(async (sortVal = sort, pageVal = 1, mode = feedMode) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        sort: sortVal,
        page: pageVal,
        limit: LIMIT
      });
      if (mode === 'following') params.set('feed', 'following');

      const { data } = await axiosInstance.get(`/posts?${params}`);
      const list = Array.isArray(data) ? data : [];
      if (pageVal === 1) setPosts(list);
      else setPosts(prev => [...prev, ...list]);
      setHasMore(list.length === LIMIT);
    } catch {}
    finally { setLoading(false); }
  }, [sort, feedMode]);

  // Re-fetch whenever sort or feed mode changes
  useEffect(() => {
    setPage(1);
    fetchPosts(sort, 1, feedMode);
  }, [sort, feedMode]);

  const handlePostCreated = async newPost => {
    // Detect session mismatch: if the returned post's author != our local user,
    // the browser's JWT cookie belongs to a different account than what we think.
    const returnedAuthorId = (newPost.userId?._id ?? newPost.userId)?.toString();
    const localUserId = (user?._id ?? user?.id)?.toString();
    if (returnedAuthorId && localUserId && returnedAuthorId !== localUserId) {
      // Force a re-sync so the UI reflects who the server actually thinks we are
      await fetchMe();
      alert(
        '⚠️ Session mismatch detected!\n\n' +
        'You may have logged into a different account in another tab.\n' +
        'Your active session has been refreshed. Please try posting again.'
      );
      setShowForm(false);
      return;
    }
    setPosts(prev => [newPost, ...prev]);
    setShowForm(false);
  };

  const handleDelete = id => setPosts(prev => prev.filter(p => p._id !== id));

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchPosts(sort, next, feedMode);
  };

  // Filter posts that have media files for the clips grid view
  const mediaPosts = posts.filter(p => p.mediaUrl && p.mediaType && p.mediaType !== 'none');

  return (
    <main className="page">
      <div className="container">
        <div className="feed-header">
          <h1 className="feed-title">🎮 The Hub</h1>
          <div className="feed-controls" style={{ gap: '0.5rem' }}>
            {/* Feed mode — only show Following tab when logged in */}
            {user && (
              <div className="sort-tabs">
                <button
                  className={`sort-tab ${feedMode === 'global' ? 'active' : ''}`}
                  onClick={() => setFeedMode('global')}
                >
                  🌐 Global
                </button>
                <button
                  className={`sort-tab ${feedMode === 'following' ? 'active' : ''}`}
                  onClick={() => setFeedMode('following')}
                >
                  👥 Following
                </button>
              </div>
            )}

            {/* Layout Toggle */}
            <div className="sort-tabs">
              <button
                className={`sort-tab ${layout === 'list' ? 'active' : ''}`}
                onClick={() => setLayout('list')}
              >
                📰 List
              </button>
              <button
                className={`sort-tab ${layout === 'clips' ? 'active' : ''}`}
                onClick={() => setLayout('clips')}
              >
                🎥 Clips
              </button>
            </div>

            {/* Sort tabs */}
            <div className="sort-tabs">
              {SORT_OPTIONS.map(({ key, label }) => (
                <button
                  key={key}
                  className={`sort-tab ${sort === key ? 'active' : ''}`}
                  onClick={() => setSort(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {user && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setShowForm(v => !v)}
              >
                {showForm ? 'Cancel' : '+ New Post'}
              </button>
            )}
          </div>
        </div>

        {showForm && (
          <PostForm onSuccess={handlePostCreated} onCancel={() => setShowForm(false)} />
        )}

        {loading && page === 1 ? (
          <div className="spinner" />
        ) : (
          <>
            {feedMode === 'following' && !loading && posts.length === 0 ? (
              <div className="post-list-empty">
                <h3>Nothing here yet</h3>
                <p>Follow some users to see their posts in your feed!</p>
              </div>
            ) : layout === 'clips' ? (
              mediaPosts.length === 0 ? (
                <div className="post-list-empty">
                  <h3>No clips found</h3>
                  <p>Be the first to upload a media clip!</p>
                </div>
              ) : (
                <div className="media-grid">
                  {mediaPosts.map(post => (
                    <ClipCard key={post._id} post={post} />
                  ))}
                </div>
              )
            ) : (
              <PostList posts={posts} onDelete={handleDelete} />
            )}
            
            {hasMore && !loading && posts.length > 0 && (
              <div style={{ textAlign: 'center', padding: '1.5rem 0 3rem' }}>
                <button className="btn btn-ghost" onClick={loadMore}>Load More</button>
              </div>
            )}
            {loading && page > 1 && <div className="spinner" />}
          </>
        )}
      </div>
    </main>
  );
};

export default Feed;
