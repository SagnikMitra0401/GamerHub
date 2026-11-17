import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import DiscoveryBoard from '../components/discover/DiscoveryBoard';
import useCursorGlow from '../hooks/useCursorGlow';

const splitGames = (value) => [...new Map(
  String(value || '')
    .split(',')
    .map((game) => game.trim())
    .filter(Boolean)
    .map((game) => [game.toLowerCase(), game])
).values()].slice(0, 5);

const Discover = () => {
  const { user } = useAuth();
  const glowRef = useCursorGlow();
  const initialGames = useMemo(
    () => (user?.preferences?.favoriteGames || []).slice(0, 5),
    [user?.preferences?.favoriteGames]
  );
  const initialPlatforms = useMemo(
    () => user?.preferences?.platforms || user?.preferredPlatforms || [],
    [user?.preferences?.platforms, user?.preferredPlatforms]
  );

  const [gamesInput, setGamesInput] = useState(initialGames.join(', '));
  const [games, setGames] = useState(initialGames);
  const [platforms, setPlatforms] = useState(initialPlatforms);

  const applyFilters = (event) => {
    event.preventDefault();
    setGames(splitGames(gamesInput));
  };

  const togglePlatform = (platform) => {
    setPlatforms((prev) => (
      prev.includes(platform) ? prev.filter((entry) => entry !== platform) : [...prev, platform]
    ));
  };

  return (
    <main className="page discover-page" ref={glowRef}>
      <div className="container">
        <header className="discover-hero">
          <span className="settings-eyebrow">Find your next session</span>
          <h1 className="page-title">Discover</h1>
          <p className="discover-subtitle">
            Tell us what you play. We will show open squads, public servers, players and tags
            that fit — no empty feed, no silent follows.
          </p>
        </header>

        <form className="discover-filter" onSubmit={applyFilters}>
          <div className="discover-filter-game">
            <label className="form-label" htmlFor="discover-games">Games</label>
            <input
              id="discover-games"
              className="form-input"
              value={gamesInput}
              placeholder="Valorant, Apex Legends…"
              onChange={(event) => setGamesInput(event.target.value)}
            />
          </div>
          <div className="discover-platforms" aria-label="Platforms">
            {['PC', 'PlayStation', 'Xbox', 'Switch'].map((platform) => (
              <button
                key={platform}
                type="button"
                className={`btn btn-sm ${platforms.includes(platform) ? 'btn-primary' : 'btn-ghost'}`}
                aria-pressed={platforms.includes(platform)}
                onClick={() => togglePlatform(platform)}
              >
                {platform}
              </button>
            ))}
          </div>
          <button className="btn btn-primary" type="submit">Find my people</button>
          <Link to="/settings" className="btn btn-ghost">Tune permanently</Link>
        </form>

        <DiscoveryBoard games={games} platforms={platforms} />
      </div>
    </main>
  );
};

export default Discover;
