import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axiosInstance from '../../api/axiosInstance';

const SearchModal = ({ isOpen, onClose }) => {
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState({ posts: [], users: [], tags: [] });
  const [loading, setLoading]   = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const navigate = useNavigate();
  const inputRef = useRef(null);

  const doSearch = useCallback(async (q) => {
    if (q.trim().length < 2) {
      setResults({ posts: [], users: [], tags: [] });
      return;
    }
    setLoading(true);
    try {
      const { data } = await axiosInstance.get(`/users/search?q=${encodeURIComponent(q.trim())}`);
      setResults(data);
    } catch {
      setResults({ posts: [], users: [], tags: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => doSearch(query), 350);
    return () => clearTimeout(t);
  }, [query, doSearch]);

  // Reset & focus when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults({ posts: [], users: [], tags: [] });
      setActiveTab('all');
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!isOpen) return null;

  const go = (path) => { onClose(); navigate(path); };

  const visiblePosts = (activeTab === 'all' || activeTab === 'posts') ? (results.posts || []) : [];
  const visibleUsers = (activeTab === 'all' || activeTab === 'users') ? (results.users || []) : [];
  const visibleTags  = (activeTab === 'all' || activeTab === 'tags')  ? (results.tags  || []) : [];
  const hasResults   = visiblePosts.length || visibleUsers.length || visibleTags.length;

  return (
    <div className="search-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Search">
      <div className="search-modal-box" onClick={e => e.stopPropagation()}>

        {/* Search Input */}
        <div className="search-input-wrap">
          <span style={{ fontSize: '1.1rem' }}>🔍</span>
          <input
            ref={inputRef}
            className="search-input"
            placeholder="Search gamers, posts, channels..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoComplete="off"
          />
          {query && (
            <button className="search-clear" onClick={() => setQuery('')} aria-label="Clear">✕</button>
          )}
        </div>

        {/* Filter Tabs */}
        {query.length >= 2 && (
          <div className="search-tabs">
            {['all', 'users', 'posts', 'tags'].map(tab => (
              <button
                key={tab}
                className={`search-tab${activeTab === tab ? ' active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'all' ? '✨ All' : tab === 'users' ? '👾 Gamers' : tab === 'posts' ? '📰 Posts' : '🏷️ Channels'}
              </button>
            ))}
          </div>
        )}

        {/* Results */}
        <div className="search-results-container">
          {loading && (
            <div className="search-loading">
              <div className="spinner" style={{ width: 24, height: 24 }} />
            </div>
          )}

          {!loading && query.length >= 2 && !hasResults && (
            <div className="search-empty">
              <span style={{ fontSize: '2rem' }}>🎮</span>
              <p>No results for "<strong>{query}</strong>"</p>
            </div>
          )}

          {!loading && hasResults && (
            <div className="search-results">
              {/* Gamers */}
              {visibleUsers.length > 0 && (
                <section>
                  <h4 className="search-section-title">👾 Gamers</h4>
                  {visibleUsers.map(u => (
                    <div key={u._id} className="search-result-item" onClick={() => go(`/u/${u.username}`)}>
                      <div className="search-result-avatar">{u.username[0].toUpperCase()}</div>
                      <div className="search-result-info">
                        <span className="search-result-name">{u.username}</span>
                        <span className="search-result-meta">
                          Lv{u.level || 1}
                          {u.role === 'admin' && <span className="role-badge admin">👑 Admin</span>}
                          {u.role === 'moderator' && <span className="role-badge mod">🛡️ Mod</span>}
                        </span>
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {/* Channels / Tags */}
              {visibleTags.length > 0 && (
                <section>
                  <h4 className="search-section-title">🏷️ Channels</h4>
                  <div className="search-tags-wrap">
                    {visibleTags.map(tag => (
                      <span key={tag} className="tag" style={{ cursor: 'pointer' }} onClick={() => go(`/c/${tag}`)}>
                        #{tag}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* Posts */}
              {visiblePosts.length > 0 && (
                <section>
                  <h4 className="search-section-title">📰 Posts</h4>
                  {visiblePosts.map(p => (
                    <div key={p._id} className="search-result-item" onClick={() => go(`/posts/${p._id}`)}>
                      {p.mediaType && p.mediaType !== 'none' && (
                        <span style={{ fontSize: '1.1rem' }}>{p.mediaType === 'video' ? '🎬' : '📷'}</span>
                      )}
                      <div className="search-result-info">
                        <span className="search-result-name">{p.title}</span>
                        <span className="search-result-meta">by {p.userId?.username}</span>
                      </div>
                    </div>
                  ))}
                </section>
              )}
            </div>
          )}

          {!query && (
            <div className="search-placeholder">
              <span style={{ fontSize: '2.5rem' }}>🎮</span>
              <p>Find gamers, posts, and channels</p>
              <p className="text-muted" style={{ fontSize: '0.82rem' }}>Type at least 2 characters to search</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SearchModal;
