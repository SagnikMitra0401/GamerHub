import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import axiosInstance from '../api/axiosInstance';
import PostList from '../components/posts/PostList';
import PostForm from '../components/posts/PostForm';
import ClipCard from '../components/posts/ClipCard';
import { StarIcon, PlusIcon, ListIcon, FilmIcon } from '../components/common/icons';
import SegmentedTabs from '../components/common/SegmentedTabs';
import { ClipGridSkeleton, PostListSkeleton } from '../components/common/Skeleton';

const LAYOUT_OPTIONS = [
  { key: 'list',  label: 'List',  icon: <ListIcon size={15} /> },
  { key: 'clips', label: 'Clips', icon: <FilmIcon size={15} /> }
];

const ChannelPage = () => {
  const { tag } = useParams();
  const { user, updateFavouriteChannels } = useAuth();
  const navigate = useNavigate();

  const [posts, setPosts]           = useState([]);
  const [layout, setLayout]         = useState('list'); // 'list' | 'clips'
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [page, setPage]             = useState(1);
  const [hasMore, setHasMore]       = useState(true);
  const [favLoading, setFavLoading] = useState(false);
  const LIMIT = 15;

  const isFav = user?.favoriteChannels?.includes(tag.toLowerCase());

  const fetchPosts = async (pageVal = 1) => {
    setLoading(true);
    try {
      const { data } = await axiosInstance.get(
        `/posts?channel=${encodeURIComponent(tag)}&page=${pageVal}&limit=${LIMIT}`
      );
      const list = Array.isArray(data) ? data : [];
      if (pageVal === 1) setPosts(list);
      else setPosts(prev => [...prev, ...list]);
      setHasMore(list.length === LIMIT);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => {
    setPage(1);
    fetchPosts(1);
  }, [tag]);

  const handleFavToggle = async () => {
    if (!user) return navigate('/login');
    if (favLoading) return;
    setFavLoading(true);
    try {
      const { data } = await axiosInstance.post('/users/channels/favourite', {
        channel: tag.toLowerCase()
      });
      updateFavouriteChannels(data.favoriteChannels);
    } catch {}
    finally { setFavLoading(false); }
  };

  const handlePostCreated = newPost => {
    setPosts(prev => [newPost, ...prev]);
    setShowForm(false);
  };

  const handleDelete = id => setPosts(prev => prev.filter(p => p._id !== id));

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchPosts(next);
  };

  const mediaPosts = posts.filter(p => p.mediaUrl && p.mediaType && p.mediaType !== 'none');

  return (
    <main className="page">
      <div className="container">
        <div className="feed-header">
          <div>
            <h1 className="feed-title">
              <span className="tag" style={{ fontSize: '1rem', marginRight: '0.5rem' }}>
                #{tag}
              </span>
              channel
            </h1>
            <p className="text-muted" style={{ marginTop: '0.25rem' }}>
              All posts tagged with #{tag}
            </p>
          </div>
          
          <div className="feed-controls">
            <div className="feed-tabs-rail">
              <SegmentedTabs
                className="seg-layout"
                ariaLabel="Channel layout"
                value={layout}
                onChange={setLayout}
                options={LAYOUT_OPTIONS}
              />
            </div>

            <div className="feed-actions">
              <button
                className={`btn btn-sm ${isFav ? 'btn-primary' : 'btn-ghost'}`}
                onClick={handleFavToggle}
                disabled={favLoading}
                title={isFav ? 'Remove from favourites' : 'Add to favourites (boosts in feed)'}
              >
                <StarIcon size={15} />
                {isFav ? 'Favourited' : 'Favourite'}
              </button>

              {user && (
                <button className="btn btn-primary btn-sm" onClick={() => setShowForm(v => !v)}>
                  {showForm ? 'Cancel' : (<><PlusIcon size={15} /> New post</>)}
                </button>
              )}
            </div>
          </div>
        </div>

        {showForm && (
          <PostForm onSuccess={handlePostCreated} onCancel={() => setShowForm(false)} />
        )}

        {loading && page === 1 ? (
          layout === 'clips'
            ? <ClipGridSkeleton />
            : <PostListSkeleton count={4} />
        ) : (
          <>
            {layout === 'clips' ? (
              mediaPosts.length === 0 ? (
                <div className="post-list-empty">
                  <h3>No clips found in this channel</h3>
                  <p>Publish a clip containing #{tag} to display it here!</p>
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
            
            {hasMore && !loading && (
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

export default ChannelPage;
