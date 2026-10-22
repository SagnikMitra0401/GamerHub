import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Link } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';

const GameDetailModal = ({ gameId, onClose }) => {
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    axiosInstance.get(`/games/${gameId}`)
      .then(({ data }) => { if (!cancelled) setGame(data); })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.message || 'Could not load this game.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [gameId]);

  const requirements = game?.minimumSystemRequirements || {};
  const requirementRows = [
    ['OS', requirements.os],
    ['Processor', requirements.processor],
    ['Memory', requirements.memory],
    ['Graphics', requirements.graphics],
    ['Storage', requirements.storage]
  ].filter(([, value]) => value);

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="game-detail-title">
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '640px' }}>
        <div className="modal-header-row">
          <h2 id="game-detail-title" className="modal-title" style={{ margin: 0 }}>
            {game?.title || 'Game details'}
          </h2>
          <button onClick={onClose} className="modal-close" aria-label="Close">✕</button>
        </div>

        {loading && <div className="spinner" />}
        {error && <div className="form-error">{error}</div>}

        {game && (
          <>
            <div className="game-detail-meta">
              <span className="lfg-tag">{game.genre}</span>
              <span className="lfg-tag">{game.platform}</span>
              <span className="lfg-tag">{game.releaseDate}</span>
            </div>
            <p className="game-detail-desc">{game.description || game.shortDescription}</p>

            {game.screenshots?.length > 0 && (
              <div className="game-shots">
                {game.screenshots.map((src) => (
                  <img key={src} src={src} alt="" loading="lazy" />
                ))}
              </div>
            )}

            {requirementRows.length > 0 && (
              <div className="game-requirements">
                <h3>Minimum requirements</h3>
                <dl>
                  {requirementRows.map(([label, value]) => (
                    <React.Fragment key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </div>
            )}

            {game.gameUrl && (
              <a className="btn btn-ghost btn-sm" href={game.gameUrl} target="_blank" rel="noreferrer noopener">
                Play for free ↗
              </a>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
};

const GameCatalog = () => {
  const { user, updateUser } = useAuth();
  const [q, setQ] = useState('');
  const [genre, setGenre] = useState('');
  const [games, setGames] = useState([]);
  const [genres, setGenres] = useState([]);
  const [meta, setMeta] = useState({ stale: false, catalogSize: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailId, setDetailId] = useState(null);
  const [saving, setSaving] = useState(null);
  const [toast, setToast] = useState('');
  const searchTimer = useRef(null);

  const load = useCallback(async (query, genreValue) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '60' });
      if (query.trim()) params.set('q', query.trim());
      if (genreValue) params.set('genre', genreValue);

      const { data } = await axiosInstance.get(`/games?${params.toString()}`);
      setGames(Array.isArray(data.games) ? data.games : []);
      setGenres(Array.isArray(data.genres) ? data.genres : []);
      setMeta({ stale: !!data.stale, catalogSize: data.catalogSize || 0 });
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load the catalog.');
      setGames([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load('', ''); }, [load]);

  // Debounced search.
  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(q, genre), 350);
    return () => clearTimeout(searchTimer.current);
  }, [q, genre, load]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const setActiveGame = async (game) => {
    setSaving(game.id);
    setError('');
    try {
      const { data } = await axiosInstance.patch('/users/presence', {
        status: 'in_game',
        activeGame: game.title
      });
      updateUser({ presence: data.presence });
      setToast(`🟣 You are now playing ${game.title}.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not set your active game.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <main className="page">
      <div className="container">
        <div className="page-header">
          <div>
            <h1 className="page-title">🎮 Game catalog</h1>
            <p className="page-subtitle">
              Browse free-to-play games{meta.catalogSize ? ` · ${meta.catalogSize} titles` : ''}. Set one as your active game and it shows up in chat and on your profile.
            </p>
          </div>
        </div>

        {toast && <div className="notice notice-success">{toast}</div>}
        {error && <div className="notice notice-error">{error}</div>}
        {meta.stale && (
          <div className="notice notice-warn">Showing a cached catalog — the provider is not responding right now.</div>
        )}

        <div className="catalog-filters">
          <input
            className="form-input"
            value={q}
            placeholder="Search games, genres, publishers…"
            aria-label="Search games"
            onChange={e => setQ(e.target.value)}
          />
          <select
            className="form-input"
            value={genre}
            aria-label="Filter by genre"
            onChange={e => setGenre(e.target.value)}
          >
            <option value="">All genres</option>
            {genres.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>

        {!user && (
          <p className="text-muted" style={{ fontSize: '0.8rem' }}>
            <Link to="/login">Sign in</Link> to set an active game.
          </p>
        )}

        {loading ? (
          <div className="spinner" />
        ) : games.length === 0 ? (
          <div className="post-list-empty">
            <h3>No games matched</h3>
            <p>Try a different search term or genre.</p>
          </div>
        ) : (
          <div className="catalog-grid">
            {games.map(game => (
              <article key={game.id} className="catalog-card">
                <img className="catalog-thumb" src={game.thumbnail} alt="" loading="lazy" />
                <div className="catalog-body">
                  <h3 className="catalog-title">{game.title}</h3>
                  <div className="lfg-tags">
                    <span className="lfg-tag">{game.genre}</span>
                    <span className="lfg-tag">{game.platform}</span>
                  </div>
                  <p className="catalog-desc">{game.shortDescription}</p>
                  <div className="catalog-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDetailId(game.id)}>
                      Details
                    </button>
                    {user && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={saving === game.id}
                        onClick={() => setActiveGame(game)}
                      >
                        {saving === game.id ? 'Saving…' : 'Set as active game'}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {detailId && <GameDetailModal gameId={detailId} onClose={() => setDetailId(null)} />}
    </main>
  );
};

export default GameCatalog;
