import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import axiosInstance from '../api/axiosInstance';
import SafeImage from '../components/common/SafeImage';

const CATEGORIES = [
  { key: 'gaming', label: 'Gaming' },
  { key: 'esports', label: 'Esports' },
  { key: 'news', label: 'News' },
  { key: 'community', label: 'Community' },
  { key: 'creator', label: 'Creator' },
  { key: 'other', label: 'Other' },
];

const ChannelCard = ({ channel }) => (
  <Link to={`/channels/${channel.slug}`} className="channel-card">
    <span className="channel-avatar">
      {channel.avatarUrl ? (
        <SafeImage src={channel.avatarUrl} alt="" />
      ) : (
        channel.name?.[0]?.toUpperCase() || '#'
      )}
    </span>
    <span className="channel-card-body">
      <span className="channel-card-name">
        {channel.name}
        {channel.unread > 0 && (
          <span className="channel-unread">{channel.unread > 99 ? '99+' : channel.unread}</span>
        )}
      </span>
      <span className="channel-card-desc">
        {channel.description || 'A one-way channel for updates.'}
      </span>
      <span className="channel-card-meta">
        <span>
          {channel.subscriberCount} subscriber{channel.subscriberCount === 1 ? '' : 's'}
        </span>
        <span>
          {channel.messageCount} post{channel.messageCount === 1 ? '' : 's'}
        </span>
        {channel.muted && <span>Muted</span>}
      </span>
    </span>
  </Link>
);

/**
 * Channel directory: what you follow, what you can discover, and a small
 * creation form (the API caps ownership at three channels).
 */
const ChannelsPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [subscriptions, setSubscriptions] = useState([]);
  const [owned, setOwned] = useState([]);
  const [discover, setDiscover] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    category: 'gaming',
    isPublic: true,
    avatarUrl: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axiosInstance.get('/channels');
      setSubscriptions(Array.isArray(data?.subscriptions) ? data.subscriptions : []);
      setOwned(Array.isArray(data?.owned) ? data.owned : []);
      setDiscover(Array.isArray(data?.discover) ? data.discover : []);
    } catch {
      setSubscriptions([]);
      setOwned([]);
      setDiscover([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createChannel = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setError('Give your channel a name.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { data } = await axiosInstance.post('/channels', form);
      setShowCreate(false);
      setForm({ name: '', description: '', category: 'gaming', isPublic: true, avatarUrl: '' });
      navigate(`/channels/${data.slug}`);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not create that channel.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="container channels-layout">
      <div className="channels-head">
        <div>
          <h1>Channels</h1>
          <p>Follow creators and servers for one-way updates, without noise or replies.</p>
        </div>
        {user && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowCreate((value) => !value)}
          >
            {showCreate ? 'Close' : 'Create a channel'}
          </button>
        )}
      </div>

      {showCreate && user && (
        <form className="channel-create" onSubmit={createChannel}>
          {error && <div className="form-error">{error}</div>}
          <div className="channel-create-row">
            <label>
              Name
              <input
                type="text"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                maxLength={50}
                placeholder="Squad updates"
                required
              />
            </label>
            <label>
              Category
              <select
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
              >
                {CATEGORIES.map((category) => (
                  <option key={category.key} value={category.key}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Avatar URL (optional)
              <input
                type="url"
                value={form.avatarUrl}
                onChange={(event) => setForm({ ...form, avatarUrl: event.target.value })}
                placeholder="https://…"
              />
            </label>
          </div>
          <label>
            Description
            <textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              maxLength={300}
              placeholder="What will you publish here?"
            />
          </label>
          <label className="channel-create-check">
            <input
              type="checkbox"
              checked={form.isPublic}
              onChange={(event) => setForm({ ...form, isPublic: event.target.checked })}
            />
            Public channel (anyone can discover and read)
          </label>
          <div className="story-sheet-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create channel'}
            </button>
          </div>
        </form>
      )}

      {owned.length > 0 && (
        <section>
          <h2 className="channels-section-title">Channels you own</h2>
          <div className="channel-grid">
            {owned.map((channel) => (
              <ChannelCard key={channel._id} channel={channel} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="channels-section-title">Your channels</h2>
        {loading ? (
          <div className="channels-empty">Loading channels…</div>
        ) : subscriptions.length === 0 ? (
          <div className="channels-empty">
            You are not following any channels yet.{' '}
            {user ? 'Pick one below.' : 'Sign in to follow channels.'}
          </div>
        ) : (
          <div className="channel-grid">
            {subscriptions.map((channel) => (
              <ChannelCard key={channel._id} channel={channel} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="channels-section-title">Discover</h2>
        {discover.length === 0 ? (
          <div className="channels-empty">No public channels to discover yet.</div>
        ) : (
          <div className="channel-grid">
            {discover.map((channel) => (
              <ChannelCard key={channel._id} channel={channel} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
};

export default ChannelsPage;
