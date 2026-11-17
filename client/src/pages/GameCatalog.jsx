import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';
import useCursorGlow from '../hooks/useCursorGlow';
import SafeImage from '../components/common/SafeImage';
import { GameGridSkeleton } from '../components/common/Skeleton';

const PAGE_SIZE = 24;

const SORTS = [
  { key: 'trending', label: 'Trending' },
  { key: 'new', label: 'Newest' },
  { key: 'az', label: 'A–Z' }
];

const GameCard = ({ game, following, busy, onFollow, onActivate, user }) => (
  <article className="catalog-card glow-card game-card">
    <Link to={`/games/${game.slug}`} className="game-card-link" aria-label={`Open ${game.title}`}>
      <div className="game-cover">
        <SafeImage
          className="catalog-thumb"
          src={game.cover}
          alt=""
          loading="lazy"
          fallback={<span className="game-cover-fallback" aria-hidden="true">{game.title.slice(0, 2).toUpperCase()}</span>}
        />
      </div>
      <div className="catalog-body">
        <h3 className="catalog-title">{game.title}</h3>
        <div className="lfg-tags">
          {(game.genres || []).slice(0, 2).map((genre) => <span key={genre} className="lfg-tag">{genre}</span>)}
          {game.releaseYear && <span className="lfg-tag">{game.releaseYear}</span>}
        </div>
        {game.summary && <p className="catalog-desc">{game.summary}</p>}
      </div>
    </Link>
    <div className="catalog-actions game-card-actions">
      <Link to={`/games/${game.slug}`} className="btn btn-ghost btn-sm">Details</Link>
      {user && (
        <>
          <button
            type="button"
            className={`btn btn-sm ${following ? 'btn-ghost' : 'btn-primary'}`}
            aria-pressed={following}
            disabled={busy === game.slug}
            onClick={() => onFollow(game)}
          >
            {busy === game.slug ? 'Saving…' : following ? 'Following' : 'Follow'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy === game.slug}
            onClick={() => onActivate(game)}
          >
            Play
          </button>
        </>
      )}
    </div>
  </article>
);

const Rail = ({ rail, favourites, ...cardProps }) => (
  <section className="game-rail" aria-labelledby={`rail-${rail.key}`}>
    <div className="game-rail-head">
      <h2 id={`rail-${rail.key}`}>{rail.label}</h2>
      <span className="admin-stat-hint">{rail.games.length} titles</span>
    </div>
    <div className="game-rail-grid">
      {rail.games.map((game) => (
        <GameCard
          key={`${rail.key}-${game.slug}`}
          game={game}
          following={favourites.has(game.title.toLowerCase())}
          {...cardProps}
        />
      ))}
    </div>
  </section>
);

const GameCatalog = () => {
  const { user, updateUser } = useAuth();
  const [q, setQ] = useState('');
  const [genre, setGenre] = useState('');
  const [platform, setPlatform] = useState('');
  const [sort, setSort] = useState('trending');
  const [games, setGames] = useState([]);
  const [rails, setRails] = useState([]);
  const [provider, setProvider] = useState(null);
  const [facets, setFacets] = useState({ genres: [], platforms: [] });
  const [cursor, setCursor] = useState(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState('');
  const searchTimer = useRef(null);
  const glowRef = useCursorGlow();

  const favourites = new Set(
    (user?.preferences?.favoriteGames || []).map((title) => String(title).toLowerCase())
  );
  const hasFilters = Boolean(q.trim() || genre || platform) || sort !== 'trending';

  const load = useCallback(async (next = {}) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), sort: next.sort ?? sort });
    const query = next.q ?? q;
    const genreValue = next.genre ?? genre;
    const platformValue = next.platform ?? platform;
    if (query.trim()) params.set('q', query.trim());
    if (genreValue) params.set('genre', genreValue);
    if (platformValue) params.set('platform', platformValue);

    setLoading(true);
    setError('');
    try {
      const { data } = await axiosInstance.get(`/games?${params.toString()}`);
      setGames(Array.isArray(data.games) ? data.games : []);
      setCursor(data.nextCursor || null);
      setTotal(data.total || 0);
      setFacets(data.facets || { genres: [], platforms: [] });
      setProvider(data.provider || null);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load the catalog.');
      setGames([]);
      setCursor(null);
    } finally {
      setLoading(false);
    }
  }, [q, genre, platform, sort]);

  const loadRails = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get('/games/rails');
      setRails(Array.isArray(data.rails) ? data.rails : []);
      if (data.provider) setProvider(data.provider);
    } catch {
      // Rails are a bonus; the grid below still works.
      setRails([]);
    }
  }, []);

  useEffect(() => {
    loadRails();
  }, [loadRails]);

  // Debounced search; filters apply immediately.
  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(), q ? 350 : 0);
    return () => clearTimeout(searchTimer.current);
  }, [q, genre, platform, sort, load]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), sort, cursor });
      if (q.trim()) params.set('q', q.trim());
      if (genre) params.set('genre', genre);
      if (platform) params.set('platform', platform);
      const { data } = await axiosInstance.get(`/games?${params.toString()}`);
      setGames((prev) => [...prev, ...(data.games || [])]);
      setCursor(data.nextCursor || null);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load more games.');
    } finally {
      setLoadingMore(false);
    }
  };

  const applyLocalFollow = (game, following) => {
    if (!user) return;
    const current = user.preferences?.favoriteGames || [];
    const next = following
      ? [...current.filter((title) => String(title).toLowerCase() !== game.title.toLowerCase()), game.title]
      : current.filter((title) => String(title).toLowerCase() !== game.title.toLowerCase());
    updateUser({ preferences: { ...(user.preferences || {}), favoriteGames: next } });
  };

  const toggleFollow = async (game) => {
    setBusy(game.slug);
    setError('');
    try {
      const { data } = await axiosInstance.post(`/games/${game.slug}/follow`);
      applyLocalFollow(game, data.following);
      setToast(data.following ? `Following ${game.title}.` : `Stopped following ${game.title}.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update that game.');
    } finally {
      setBusy(null);
    }
  };

  const setActiveGame = async (game) => {
    setBusy(game.slug);
    setError('');
    try {
      const { data } = await axiosInstance.patch('/users/presence', {
        status: 'in_game',
        activeGame: game.title
      });
      updateUser({ presence: data.presence });
      setToast(`You are now playing ${game.title}.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not set your active game.');
    } finally {
      setBusy(null);
    }
  };

  const cardProps = {
    user,
    busy,
    onFollow: toggleFollow,
    onActivate: setActiveGame
  };

  return (
    <main className="page" ref={glowRef}>
      <div className="container">
        <header className="games-hero">
          <span className="settings-eyebrow">The catalog</span>
          <h1 className="page-title">Every game worth showing up for.</h1>
          <p className="page-subtitle">
            {total ? `${total.toLocaleString()} games` : 'Games'} in the GamerHub catalog — search one,
            follow it, and jump into the squads and servers already playing it.
          </p>
          <div className="games-search-row">
            <input
              className="form-input"
              value={q}
              placeholder="Search games, genres, publishers…"
              aria-label="Search games"
              onChange={(event) => setQ(event.target.value)}
            />
          </div>
        </header>

        {toast && <div className="notice notice-success">{toast}</div>}
        {error && <div className="notice notice-error">{error}</div>}

        <div className="catalog-filters games-filters">
          <select className="form-input" value={genre} aria-label="Filter by genre" onChange={(e) => setGenre(e.target.value)}>
            <option value="">All genres</option>
            {(facets.genres || []).map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select className="form-input" value={platform} aria-label="Filter by platform" onChange={(e) => setPlatform(e.target.value)}>
            <option value="">All platforms</option>
            {(facets.platforms || []).map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select className="form-input" value={sort} aria-label="Sort games" onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
          {(q || genre || platform || sort !== 'trending') && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { setQ(''); setGenre(''); setPlatform(''); setSort('trending'); }}
            >
              Clear
            </button>
          )}
        </div>

        {!user && (
          <p className="text-muted" style={{ fontSize: '0.8rem' }}>
            <Link to="/login">Sign in</Link> to follow a game or set it as your active game.
          </p>
        )}

        {!hasFilters && rails.length > 0 && (
          <div className="game-rails">
            {rails.map((rail) => (
              <Rail key={rail.key} rail={rail} favourites={favourites} {...cardProps} />
            ))}
          </div>
        )}

        <section className="games-grid-section" aria-labelledby="all-games-title">
          <div className="game-rail-head">
            <h2 id="all-games-title">{hasFilters ? 'Results' : 'Browse the catalog'}</h2>
            {total > 0 && <span className="admin-stat-hint">{total.toLocaleString()} matching</span>}
          </div>

          {loading ? (
            <GameGridSkeleton />
          ) : games.length === 0 ? (
            <div className="post-list-empty">
              <h3>No games matched</h3>
              <p>Try a different title, genre or platform.</p>
            </div>
          ) : (
            <>
              <div className="catalog-grid games-grid">
                {games.map((game) => (
                  <GameCard
                    key={game.slug}
                    game={game}
                    following={favourites.has(game.title.toLowerCase())}
                    busy={busy}
                    onFollow={toggleFollow}
                    onActivate={setActiveGame}
                    user={user}
                  />
                ))}
              </div>
              {cursor && (
                <div className="games-more">
                  <button type="button" className="btn btn-ghost" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? 'Loading…' : 'Load more games'}
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <footer className="games-attribution">
          {provider?.attribution || 'Game data by FreeToGame'}
          {provider?.enriched ? ' · Enriched with IGDB' : ''}
        </footer>
      </div>
    </main>
  );
};

export default GameCatalog;
