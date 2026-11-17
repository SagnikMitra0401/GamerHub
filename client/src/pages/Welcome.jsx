import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';
import DiscoveryBoard from '../components/discover/DiscoveryBoard';
import SafeImage from '../components/common/SafeImage';
import {
  ArrowLeftIcon, ArrowRightIcon, CheckIcon, CompassIcon, GamepadIcon, SparklesIcon
} from '../components/common/icons';

const PLATFORMS = ['PC', 'PlayStation', 'Xbox', 'Switch'];
const MAX_GAMES = 3;
const SHORTCUTS = [
  'Valorant', 'Apex Legends', 'Fortnite', 'Counter-Strike 2',
  'League of Legends', 'Overwatch 2', 'Minecraft', 'Elden Ring',
  'Rocket League', 'Call of Duty'
];

const steps = [
  { key: 'games', label: 'Games', icon: GamepadIcon },
  { key: 'platforms', label: 'Platforms', icon: SparklesIcon },
  { key: 'people', label: 'People', icon: CompassIcon }
];

const splitGames = (value) => [...new Map(
  String(value || '')
    .split(',')
    .map((game) => game.trim())
    .filter(Boolean)
    .map((game) => [game.toLowerCase(), game])
).values()];

const Welcome = () => {
  const { user, updateUser } = useAuth();
  const [searchParams] = useSearchParams();
  const nextParam = searchParams.get('next') || '';
  const nextPath = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '';

  const [step, setStep] = useState(0);
  const [games, setGames] = useState(
    () => (user?.preferences?.favoriteGames || []).slice(0, MAX_GAMES)
  );
  const [platforms, setPlatforms] = useState(
    () => user?.preferences?.platforms || user?.preferredPlatforms || []
  );
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [completion, setCompletion] = useState(null);

  const gamesKey = useMemo(() => games.join('|'), [games]);

  useEffect(() => {
    // First-party activation breadcrumb. Failure is intentionally silent: it
    // must never block the onboarding screen.
    axiosInstance.post('/discover/onboarding/start').catch(() => {});
  }, []);

  const addGame = (raw) => {
    const game = String(raw || '').trim().slice(0, 60);
    if (!game) return;
    setError('');
    setGames((prev) => {
      if (prev.some((entry) => entry.toLowerCase() === game.toLowerCase())) return prev;
      if (prev.length >= MAX_GAMES) {
        setError(`Pick up to ${MAX_GAMES} games. Remove one first.`);
        return prev;
      }
      return [...prev, game];
    });
  };

  const removeGame = (game) => setGames((prev) => prev.filter((entry) => entry !== game));

  const togglePlatform = (platform) => {
    setPlatforms((prev) => (
      prev.includes(platform) ? prev.filter((entry) => entry !== platform) : [...prev, platform]
    ));
  };

  const searchCatalog = async (event) => {
    event?.preventDefault();
    const search = query.trim();
    if (!search) return;
    setSearching(true);
    setError('');
    try {
      const { data } = await axiosInstance.get('/games', { params: { q: search, limit: 8 } });
      setResults(data.games || []);
    } catch (err) {
      setError(err.response?.data?.message || 'The catalog is unavailable. You can still type a game.');
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const finish = async ({ skipped = false } = {}) => {
    setSaving(true);
    setError('');
    try {
      const { data } = await axiosInstance.post('/discover/onboarding/complete', {
        games,
        platforms,
        skipped
      });
      updateUser({
        onboardingCompletedAt: data.onboardingCompletedAt,
        preferences: data.preferences
      });
      setCompletion({ skipped });
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save your onboarding choices.');
    } finally {
      setSaving(false);
    }
  };

  if (completion) {
    return (
      <main className="page welcome-page">
        <div className="container welcome-complete">
          <div className="welcome-complete-mark"><CheckIcon size={28} /></div>
          <span className="settings-eyebrow">You are in</span>
          <h1 className="page-title">
            {completion.skipped ? 'Your account is ready' : 'Your feed is tuned'}
          </h1>
          <p className="discover-subtitle">
            {completion.skipped
              ? 'You can tune your games and platforms any time from Discover.'
              : 'We saved your games and platforms. Discover is ready whenever you want another squad or server.'}
          </p>
          <div className="welcome-complete-actions">
            {nextPath && <Link to={nextPath} className="btn btn-primary">Continue</Link>}
            <Link to="/discover" className="btn btn-primary">Explore Discover</Link>
            <Link to="/" className="btn btn-ghost">Go to feed</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page welcome-page">
      <div className="container welcome-shell">
        <header className="welcome-hero">
          <span className="settings-eyebrow">First session setup</span>
          <h1 className="page-title">Find your people before the feed finds you.</h1>
          <p className="discover-subtitle">
            Pick what you play, then jump into a squad, server or player. Every step is optional.
          </p>
          <ol className="welcome-steps" aria-label="Onboarding steps">
            {steps.map((entry, index) => {
              const Icon = entry.icon;
              const state = index === step ? 'current' : index < step ? 'done' : 'upcoming';
              return (
                <li key={entry.key} className={`welcome-step is-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
                  <span className="welcome-step-index">{index < step ? <CheckIcon size={13} /> : index + 1}</span>
                  <Icon size={15} />
                  <span>{entry.label}</span>
                </li>
              );
            })}
          </ol>
        </header>

        {error && <div className="notice notice-error" role="alert">{error}</div>}

        {step === 0 && (
          <section className="welcome-panel">
            <h2>What are you playing?</h2>
            <p className="text-muted">Choose up to {MAX_GAMES}. A free-text game is fine if the catalog misses it.</p>

            <form className="welcome-game-search" onSubmit={searchCatalog}>
              <input
                className="form-input"
                value={query}
                placeholder="Search the game catalog…"
                aria-label="Search games"
                maxLength={60}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button className="btn btn-ghost" type="submit" disabled={searching || !query.trim()}>
                {searching ? 'Searching…' : 'Search'}
              </button>
              <button className="btn btn-primary" type="button" disabled={!query.trim()} onClick={() => addGame(query)}>
                Add “{query.trim().slice(0, 20) || 'game'}”
              </button>
            </form>

            {results.length > 0 && (
              <div className="welcome-results" aria-label="Catalog results">
                {results.map((game) => (
                  <button
                    key={game.id}
                    type="button"
                    className="welcome-result"
                    onClick={() => {
                      addGame(game.title);
                      setQuery('');
                      setResults([]);
                    }}
                  >
                    <SafeImage src={game.thumbnail} alt="" loading="lazy" fallback={null} />
                    <span>{game.title}</span>
                    <small>{game.genre}</small>
                  </button>
                ))}
              </div>
            )}

            <div className="welcome-shortcuts">
              {SHORTCUTS.map((game) => (
                <button
                  key={game}
                  type="button"
                  className={`welcome-chip${games.some((entry) => entry.toLowerCase() === game.toLowerCase()) ? ' is-selected' : ''}`}
                  aria-pressed={games.some((entry) => entry.toLowerCase() === game.toLowerCase())}
                  onClick={() => addGame(game)}
                >
                  {game}
                </button>
              ))}
            </div>

            <div className="welcome-selected">
              <h3>Your games</h3>
              {games.length === 0 ? (
                <p className="text-muted">Nothing selected yet — you can skip and choose later.</p>
              ) : (
                <div className="welcome-chips">
                  {games.map((game) => (
                    <button key={game} type="button" className="welcome-chip is-selected" onClick={() => removeGame(game)}>
                      {game} <span aria-hidden="true">×</span>
                      <span className="sr-only">Remove {game}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="welcome-panel">
            <h2>Where do you play?</h2>
            <p className="text-muted">Pick any platforms you use. This stays editable in Settings.</p>
            <div className="welcome-platform-grid">
              {PLATFORMS.map((platform) => (
                <button
                  key={platform}
                  type="button"
                  className={`welcome-platform${platforms.includes(platform) ? ' is-selected' : ''}`}
                  aria-pressed={platforms.includes(platform)}
                  onClick={() => togglePlatform(platform)}
                >
                  <GamepadIcon size={22} />
                  <span>{platform}</span>
                  {platforms.includes(platform) && <CheckIcon size={15} />}
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="welcome-panel welcome-panel-wide">
            <div className="welcome-people-head">
              <div>
                <h2>Here is who is playing</h2>
                <p className="text-muted">
                  {games.length
                    ? `Suggestions based on ${games.join(', ')}. Join or follow only what you choose.`
                    : 'Showing popular public servers and squads until you pick games.'}
                </p>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep(0)}>
                Edit games
              </button>
            </div>
            <DiscoveryBoard key={gamesKey} games={games} platforms={platforms} />
          </section>
        )}

        <footer className="welcome-footer">
          <div>
            {step > 0 && (
              <button type="button" className="btn btn-ghost" onClick={() => setStep((value) => value - 1)}>
                <ArrowLeftIcon size={15} /> Back
              </button>
            )}
          </div>
          <div className="welcome-footer-actions">
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => finish({ skipped: true })}>
              Skip for now
            </button>
            {step < 2 ? (
              <button type="button" className="btn btn-primary" onClick={() => setStep((value) => value + 1)}>
                Continue <ArrowRightIcon size={15} />
              </button>
            ) : (
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => finish()}>
                {saving ? 'Saving…' : 'Finish setup'} <CheckIcon size={15} />
              </button>
            )}
          </div>
        </footer>
      </div>
    </main>
  );
};

export default Welcome;
