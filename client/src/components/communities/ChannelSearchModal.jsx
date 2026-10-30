import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import axiosInstance from '../../api/axiosInstance';
import { CloseIcon, PinIcon, SearchIcon } from '../common/icons';

/**
 * Search + pins for one channel or the whole server.
 *
 * Search runs server-side and is already scoped to channels the caller may read,
 * so a result can never leak a private channel's text. Pins are the moderator
 * tray for the active channel.
 */
const ChannelSearchModal = ({ isOpen, onClose, communityId, channelId, onJump }) => {
  const [tab, setTab] = useState('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ messages: [], forumPosts: [] });
  const [pins, setPins] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scopeChannelOnly, setScopeChannelOnly] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setTab('search');
    setQuery('');
    setResults({ messages: [], forumPosts: [] });
    setPins([]);
    setError('');
    setScopeChannelOnly(false);
  }, [isOpen, channelId]);

  useEffect(() => {
    if (!isOpen || tab !== 'pins' || !channelId) return undefined;
    let cancelled = false;
    setLoading(true);
    axiosInstance.get(`/communities/channels/${channelId}/pins`)
      .then(({ data }) => { if (!cancelled) setPins(data.messages || []); })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.message || 'Could not load pins.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, tab, channelId]);

  if (!isOpen) return null;

  const runSearch = async (event) => {
    event?.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;

    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ q });
      if (scopeChannelOnly && channelId) params.set('channelId', channelId);
      const { data } = await axiosInstance.get(`/communities/${communityId}/search?${params}`);
      setResults({ messages: data.messages || [], forumPosts: data.forumPosts || [] });
    } catch (err) {
      setError(err.response?.data?.message || 'Search failed.');
      setResults({ messages: [], forumPosts: [] });
    } finally {
      setLoading(false);
    }
  };

  const jump = (resultChannelId, messageId) => {
    onJump?.(resultChannelId, messageId);
    onClose?.();
  };

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="search-modal-title">
      <div className="modal-box search-modal-box" onClick={event => event.stopPropagation()}>
        <div className="modal-header-row">
          <h2 id="search-modal-title" className="modal-title" style={{ margin: 0 }}>Search &amp; pins</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="forum-filters" style={{ marginBottom: '0.75rem' }}>
          <button
            type="button"
            className={`forum-filter${tab === 'search' ? ' active' : ''}`}
            onClick={() => setTab('search')}
          >
            Search
          </button>
          <button
            type="button"
            className={`forum-filter${tab === 'pins' ? ' active' : ''}`}
            onClick={() => setTab('pins')}
          >
            <PinIcon size={12} /> Pinned
          </button>
        </div>

        {error && <div className="form-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}

        {tab === 'search' ? (
          <>
            <form onSubmit={runSearch} className="search-modal-form">
              <input
                className="form-input"
                placeholder="Search messages and forum threads…"
                value={query}
                maxLength={100}
                onChange={event => setQuery(event.target.value)}
                aria-label="Search query"
                autoFocus
              />
              <button className="btn btn-primary btn-sm" disabled={loading || query.trim().length < 2}>
                <SearchIcon size={14} />
              </button>
            </form>

            {channelId && (
              <label className="checkbox-row" style={{ marginBottom: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={scopeChannelOnly}
                  onChange={event => setScopeChannelOnly(event.target.checked)}
                />
                Only this channel
              </label>
            )}

            {loading ? (
              <div className="spinner" />
            ) : (
              <div className="search-results">
                {results.messages.map(message => (
                  <button
                    key={message._id}
                    type="button"
                    className="search-result"
                    onClick={() => jump(message.channelId, message._id)}
                  >
                    <div className="search-result-head">
                      <span className="search-result-channel">#{message.channelName || 'channel'}</span>
                      <span className="chat-timestamp">{new Date(message.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="search-result-body">{message.text}</div>
                    <div className="search-result-meta">{message.sender?.username || 'Unknown'}</div>
                  </button>
                ))}

                {results.forumPosts.map(post => (
                  <button
                    key={post._id}
                    type="button"
                    className="search-result"
                    onClick={() => jump(post.channelId)}
                  >
                    <div className="search-result-head">
                      <span className="search-result-channel">#{post.channelName || 'forum'}</span>
                      <span className="forum-status">{post.status}</span>
                    </div>
                    <div className="search-result-body">{post.title}</div>
                    <div className="search-result-meta">{post.author?.username || 'Unknown'}</div>
                  </button>
                ))}

                {!loading && query.trim().length >= 2 &&
                  results.messages.length === 0 && results.forumPosts.length === 0 && (
                    <p className="text-muted" style={{ textAlign: 'center', padding: '1rem 0' }}>
                      Nothing matched “{query.trim()}”.
                    </p>
                  )}
              </div>
            )}
          </>
        ) : (
          <div className="search-results">
            {loading && <div className="spinner" />}
            {!loading && pins.length === 0 && (
              <p className="text-muted" style={{ textAlign: 'center', padding: '1rem 0' }}>
                No pinned messages in this channel.
              </p>
            )}
            {pins.map(message => (
              <div key={message._id} className="search-result">
                <div className="search-result-head">
                  <span className="search-result-channel">{message.senderId?.username || 'Unknown'}</span>
                  <span className="chat-timestamp">{new Date(message.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="search-result-body">{message.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default ChannelSearchModal;
