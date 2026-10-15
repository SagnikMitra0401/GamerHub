import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';
import CreateCommunityModal from '../components/communities/CreateCommunityModal';

const CommunitiesHome = () => {
  const { user } = useAuth();
  const [communities, setCommunities]   = useState([]);
  const [loading, setLoading]           = useState(true);
  const [showCreate, setShowCreate]     = useState(false);
  const [search, setSearch]             = useState('');

  useEffect(() => {
    const fetchCommunities = async () => {
      setLoading(true);
      try {
        const { data } = await axiosInstance.get('/communities');
        setCommunities(data);
      } catch {
        setCommunities([]);
      } finally {
        setLoading(false);
      }
    };
    fetchCommunities();
  }, []);

  const handleCreated = (newCommunity) => {
    setCommunities(prev => [newCommunity, ...prev]);
  };

  const filtered = search.trim()
    ? communities.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.description?.toLowerCase().includes(search.toLowerCase())
      )
    : communities;

  return (
    <main className="page">
      <div className="container" style={{ paddingTop: '1.5rem', paddingBottom: '5rem' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>🏰 Communities</h1>
            <p className="text-muted" style={{ margin: '0.25rem 0 0', fontSize: '0.9rem' }}>
              Join squads, discover guilds, and chat in real-time with gamers worldwide.
            </p>
          </div>
          {user && (
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              ➕ Create Community
            </button>
          )}
        </div>

        {/* Search */}
        <div style={{ marginBottom: '1.25rem' }}>
          <input
            className="form-input"
            placeholder="🔍 Search communities..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ maxWidth: '400px' }}
          />
        </div>

        {/* Communities Grid */}
        {loading ? (
          <div className="spinner" />
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: '2.5rem' }}>🏜️</p>
            <p>No communities found. Be the first to create one!</p>
            {user && (
              <button className="btn btn-primary" onClick={() => setShowCreate(true)} style={{ marginTop: '0.75rem' }}>
                Create Community
              </button>
            )}
          </div>
        ) : (
          <div className="communities-grid">
            {filtered.map(c => {
              const isMember = user && c.members?.some(m =>
                (typeof m.userId === 'string' ? m.userId : m.userId?._id?.toString()) === user._id?.toString()
              );
              return (
                <Link key={c._id} to={`/communities/${c.slug}`} className="community-card" style={{ textDecoration: 'none' }}>
                  <div className="community-card-icon">{c.icon}</div>
                  <div className="community-card-body">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>{c.name}</h3>
                      {c.isPrivate && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>🔒</span>}
                      {isMember && <span style={{ fontSize: '0.7rem', background: 'var(--accent)', color: '#fff', borderRadius: '6px', padding: '0 5px' }}>Joined</span>}
                    </div>
                    <p className="text-muted" style={{ fontSize: '0.82rem', margin: '0.25rem 0 0.5rem', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {c.description || 'No description provided.'}
                    </p>
                    <div className="text-muted" style={{ fontSize: '0.76rem' }}>
                      👥 {c.members?.length || 0} member{(c.members?.length || 0) !== 1 ? 's' : ''}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <CreateCommunityModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={handleCreated}
      />
    </main>
  );
};

export default CommunitiesHome;
