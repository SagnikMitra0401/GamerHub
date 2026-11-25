import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';
import SafeImage from '../components/common/SafeImage';
import { PostListSkeleton } from '../components/common/Skeleton';

const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '—');

const Stat = ({ label, value }) => (
  <div className="game-stat">
    <span className="game-stat-value">{value ?? 0}</span>
    <span className="game-stat-label">{label}</span>
  </div>
);

const GameDetail = () => {
  const { slug } = useParams();
  const { user, updateUser } = useAuth();
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await axiosInstance.get(`/games/${encodeURIComponent(slug)}`);
      setGame(data);
    } catch (err) {
      setGame(null);
      setError(
        err.response?.status === 404
          ? 'We could not find that game in the catalog.'
          : err.response?.data?.message || 'Could not load this game.',
      );
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const toggleFollow = async () => {
    if (!game) return;
    setBusy(true);
    setToast('');
    try {
      const { data } = await axiosInstance.post(`/games/${game.slug}/follow`);
      setGame((prev) => ({
        ...prev,
        following: data.following,
        stats: {
          ...prev.stats,
          favoriteCount: Math.max(0, (prev.stats?.favoriteCount || 0) + (data.following ? 1 : -1)),
        },
      }));
      const current = user?.preferences?.favoriteGames || [];
      const next = data.following
        ? [
            ...current.filter((title) => String(title).toLowerCase() !== game.title.toLowerCase()),
            game.title,
          ]
        : current.filter((title) => String(title).toLowerCase() !== game.title.toLowerCase());
      updateUser({ preferences: { ...(user?.preferences || {}), favoriteGames: next } });
      setToast(data.following ? `Following ${game.title}.` : `Stopped following ${game.title}.`);
    } catch (err) {
      setToast(err.response?.data?.message || 'Could not update that game.');
    } finally {
      setBusy(false);
    }
  };

  const setActive = async () => {
    if (!game) return;
    setBusy(true);
    try {
      const { data } = await axiosInstance.patch('/users/presence', {
        status: 'in_game',
        activeGame: game.title,
      });
      updateUser({ presence: data.presence });
      setToast(`You are now playing ${game.title}.`);
    } catch (err) {
      setToast(err.response?.data?.message || 'Could not set your active game.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <main className="page">
        <div className="container">
          <PostListSkeleton count={2} />
        </div>
      </main>
    );
  }

  if (error || !game) {
    return (
      <main className="page">
        <div className="container">
          <div className="post-list-empty">
            <h3>Game unavailable</h3>
            <p>{error || 'Game not found.'}</p>
            <Link to="/games" className="btn btn-primary btn-sm">
              Back to the catalog
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const requirements = game.requirements || {};
  const requirementRows = [
    ['OS', requirements.os],
    ['Processor', requirements.processor],
    ['Memory', requirements.memory],
    ['Graphics', requirements.graphics],
    ['Storage', requirements.storage],
  ].filter(([, value]) => value);

  return (
    <main className="page game-detail-page">
      <div className="container">
        <nav className="game-breadcrumb" aria-label="Breadcrumb">
          <Link to="/games">Games</Link>
          <span aria-hidden="true">/</span>
          <span>{game.title}</span>
        </nav>

        {toast && <div className="notice notice-success">{toast}</div>}

        <header className={`game-hero${game.cover ? ' has-cover' : ''}`}>
          <SafeImage
            className="game-hero-cover"
            src={game.cover}
            alt=""
            fallback={
              <span className="game-hero-cover game-hero-cover-fallback" aria-hidden="true">
                {game.title.slice(0, 2).toUpperCase()}
              </span>
            }
          />
          <div className="game-hero-body">
            <div className="lfg-tags">
              {(game.genres || []).map((genre) => (
                <span key={genre} className="lfg-tag">
                  {genre}
                </span>
              ))}
              {(game.platforms || []).slice(0, 3).map((platform) => (
                <span key={platform} className="lfg-tag">
                  {platform}
                </span>
              ))}
              {game.releaseYear && <span className="lfg-tag">{game.releaseYear}</span>}
            </div>
            <h1 className="page-title">{game.title}</h1>
            {game.summary && <p className="game-hero-summary">{game.summary}</p>}

            <div className="game-actions">
              {user ? (
                <>
                  <button
                    type="button"
                    className={`btn ${game.following ? 'btn-ghost' : 'btn-primary'}`}
                    onClick={toggleFollow}
                    disabled={busy}
                    aria-pressed={game.following}
                  >
                    {game.following ? 'Following' : 'Follow game'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={setActive}
                    disabled={busy}
                  >
                    Set as active game
                  </button>
                </>
              ) : (
                <Link to="/login" className="btn btn-primary">
                  Sign in to follow
                </Link>
              )}
              <Link to={`/lfg`} className="btn btn-ghost">
                Find a squad
              </Link>
            </div>
          </div>
        </header>

        <section className="game-stats" aria-label="Game activity">
          <Stat label="players playing now" value={game.stats?.playerCount} />
          <Stat label="following" value={game.stats?.favoriteCount} />
          <Stat label="open squads" value={game.stats?.squadCount} />
          <Stat label="servers" value={game.stats?.serverCount} />
          <Stat label="posts" value={game.stats?.postCount} />
        </section>

        {game.screenshots?.length > 0 && (
          <section className="admin-card">
            <div className="admin-card-head">
              <h2>Screenshots</h2>
            </div>
            <div className="game-shots">
              {game.screenshots.map((src) => (
                <SafeImage key={src} src={src} alt="" loading="lazy" fallback={null} />
              ))}
            </div>
          </section>
        )}

        <div className="game-detail-columns">
          <section className="admin-card">
            <div className="admin-card-head">
              <h2>Open squads</h2>
            </div>
            {game.openSquads?.length ? (
              <ul className="game-link-list">
                {game.openSquads.map((squad) => (
                  <li key={squad.id}>
                    <Link to={`/lfg`}>
                      {squad.activity || 'Squad'} · {squad.memberCount}/{squad.maxSlots}
                    </Link>
                    <span className="admin-stat-hint">
                      {squad.micRequired ? 'mic required' : 'no mic'} ·{' '}
                      {squad.leader?.username || 'leader'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="admin-note">No open squads for this game right now.</p>
            )}
          </section>

          <section className="admin-card">
            <div className="admin-card-head">
              <h2>Servers playing it</h2>
            </div>
            {game.communities?.length ? (
              <ul className="game-link-list">
                {game.communities.map((community) => (
                  <li key={community.id}>
                    <Link to={`/communities/${community.slug}`}>{community.name}</Link>
                    <span className="admin-stat-hint">{community.memberCount} members</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="admin-note">No server has tagged this game yet.</p>
            )}
          </section>

          {requirementRows.length > 0 && (
            <section className="admin-card">
              <div className="admin-card-head">
                <h2>Minimum requirements</h2>
              </div>
              <dl className="game-requirements">
                {requirementRows.map(([label, value]) => (
                  <React.Fragment key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </section>
          )}
        </div>

        <section className="admin-card">
          <div className="admin-card-head">
            <h2>Recent posts</h2>
          </div>
          {game.recentPosts?.length ? (
            <ul className="game-link-list">
              {game.recentPosts.map((post) => (
                <li key={post._id}>
                  <Link to={`/posts/${post._id}`}>{post.title}</Link>
                  <span className="admin-stat-hint">
                    @{post.author?.username || 'player'} · {formatDate(post.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-note">No posts tagged with this game yet. Be the first.</p>
          )}
        </section>

        {game.related?.length > 0 && (
          <section className="game-rail" aria-labelledby="related-games">
            <div className="game-rail-head">
              <h2 id="related-games">Players also look at</h2>
            </div>
            <div className="game-rail-grid">
              {game.related.map((related) => (
                <article key={related.slug} className="catalog-card glow-card game-card">
                  <Link to={`/games/${related.slug}`} className="game-card-link">
                    <div className="game-cover">
                      <SafeImage
                        className="catalog-thumb"
                        src={related.cover}
                        alt=""
                        loading="lazy"
                        fallback={
                          <span className="game-cover-fallback">
                            {related.title.slice(0, 2).toUpperCase()}
                          </span>
                        }
                      />
                    </div>
                    <div className="catalog-body">
                      <h3 className="catalog-title">{related.title}</h3>
                      <div className="lfg-tags">
                        {(related.genres || []).slice(0, 2).map((genre) => (
                          <span key={genre} className="lfg-tag">
                            {genre}
                          </span>
                        ))}
                      </div>
                    </div>
                  </Link>
                </article>
              ))}
            </div>
          </section>
        )}

        <footer className="games-attribution">
          {game.provider?.attribution || 'Game data by FreeToGame'}
        </footer>
      </div>
    </main>
  );
};

export default GameDetail;
