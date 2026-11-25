import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axiosInstance from '../../api/axiosInstance';
import CommunitySigil from '../communities/CommunitySigil';
import { UsersIcon, SparklesIcon, SearchIcon } from '../common/icons';

/**
 * Shared recommendation surface for /welcome and /discover.
 *
 * The server owns the ranking and the privacy rules; this component only makes
 * the explicit actions (request, join, follow) clickable. Nothing here follows
 * or joins anything automatically.
 */
const DiscoveryBoard = ({ games = [], platforms = [] }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState('');
  const [joined, setJoined] = useState(new Set());
  const [requested, setRequested] = useState(new Set());
  const [followed, setFollowed] = useState(new Set());

  const gamesKey = useMemo(() => games.filter(Boolean).join(','), [games]);
  const platformsKey = useMemo(() => platforms.filter(Boolean).join(','), [platforms]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams();
        if (gamesKey) params.set('games', gamesKey);
        if (platformsKey) params.set('platforms', platformsKey);
        const { data: payload } = await axiosInstance.get(
          `/discover/onboarding?${params.toString()}`,
        );
        if (!cancelled) setData(payload);
      } catch (err) {
        if (!cancelled)
          setError(err.response?.data?.message || 'Could not load suggestions right now.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gamesKey, platformsKey]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const act = async (key, request, success, onSuccess) => {
    setBusy(key);
    setError('');
    try {
      await request();
      setToast(success);
      onSuccess?.();
    } catch (err) {
      setError(err.response?.data?.message || 'That action could not be completed.');
    } finally {
      setBusy('');
    }
  };

  const joinCommunity = (community) =>
    act(
      `community:${community.id}`,
      () => axiosInstance.post(`/communities/${community.id}/join`),
      `Joined ${community.name}.`,
      () => setJoined((prev) => new Set(prev).add(community.id)),
    );

  const requestSquad = (squad) =>
    act(
      `squad:${squad.id}`,
      () => axiosInstance.post(`/lfg/${squad.id}/request`, { message: '' }),
      `Request sent to @${squad.leader?.username || 'the leader'}.`,
      () => setRequested((prev) => new Set(prev).add(squad.id)),
    );

  const followPlayer = (player) =>
    act(
      `player:${player.username}`,
      () => axiosInstance.post(`/users/${player.username}/follow`),
      `Following @${player.username}.`,
      () => setFollowed((prev) => new Set(prev).add(player.username)),
    );

  if (loading) {
    return (
      <div className="discover-loading" role="status">
        <span className="spinner" />
        <p>Finding players, servers and squads for you…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="notice notice-error">{error || 'Could not load suggestions right now.'}</div>
    );
  }

  const squads = data.squads || [];
  const communities = data.communities || [];
  const players = data.players || [];
  const tags = data.tags || [];

  return (
    <div className="discover-board">
      {toast && (
        <div className="notice notice-success" role="status">
          {toast}
        </div>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      <section className="discover-section">
        <div className="discover-section-head">
          <div>
            <h2 className="section-heading">
              <UsersIcon size={17} /> Open squads
            </h2>
            <p className="discover-section-hint">
              {data.fallback?.squads
                ? 'Popular now. No exact game match yet.'
                : 'Squads recruiting for the games you picked.'}
            </p>
          </div>
          <Link to="/lfg" className="btn btn-ghost btn-sm">
            Open LFG
          </Link>
        </div>

        {squads.length === 0 ? (
          <div className="discover-empty">
            <p>No squads are recruiting right now.</p>
            <Link to="/lfg" className="btn btn-primary btn-sm">
              Create the first squad
            </Link>
          </div>
        ) : (
          <div className="discover-grid">
            {squads.map((squad) => {
              const isRequested = requested.has(squad.id);
              return (
                <article key={squad.id} className="discover-card">
                  <div className="discover-card-top">
                    <span className="discover-kicker">{squad.gameTitle}</span>
                    {squad.popular && <span className="discover-popular">Popular</span>}
                  </div>
                  <h3>{squad.activity || 'Any activity'}</h3>
                  <p className="discover-meta">
                    {squad.openSlots} of {squad.maxSlots} slots open
                    {squad.micRequired ? ' · mic required' : ''}
                  </p>
                  <p className="discover-person">
                    <span className="discover-avatar">
                      {(squad.leader?.username || '?').slice(0, 1).toUpperCase()}
                    </span>
                    @{squad.leader?.username || 'unknown'} · Lv {squad.leader?.level || 1}
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm btn-full"
                    disabled={isRequested || busy === `squad:${squad.id}`}
                    onClick={() => requestSquad(squad)}
                  >
                    {isRequested
                      ? 'Request sent'
                      : busy === `squad:${squad.id}`
                        ? 'Sending…'
                        : 'Request to join'}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="discover-section">
        <div className="discover-section-head">
          <div>
            <h2 className="section-heading">
              <SparklesIcon size={17} /> Servers for you
            </h2>
            <p className="discover-section-hint">
              {data.fallback?.communities
                ? 'Popular now: public servers worth a look.'
                : 'Public servers that match your games.'}
            </p>
          </div>
          <Link to="/communities" className="btn btn-ghost btn-sm">
            Browse servers
          </Link>
        </div>

        {communities.length === 0 ? (
          <div className="discover-empty">
            <p>No public servers match yet.</p>
            <Link to="/communities" className="btn btn-primary btn-sm">
              Browse all servers
            </Link>
          </div>
        ) : (
          <div className="discover-grid discover-grid-servers">
            {communities.map((community) => {
              const isJoined = joined.has(community.id);
              return (
                <article key={community.id} className="discover-card discover-server-card">
                  <div className="discover-card-top">
                    <CommunitySigil name={community.name} icon={community.icon} size={38} />
                    <span className="discover-members">
                      {community.memberCount} member{community.memberCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  <h3>
                    <Link to={`/communities/${community.slug}`}>{community.name}</Link>
                  </h3>
                  <p className="discover-description">
                    {community.description || 'No description yet.'}
                  </p>
                  {community.games?.length > 0 && (
                    <p className="discover-tags">
                      {community.games.map((game) => (
                        <span key={game} className="discover-tag">
                          {game}
                        </span>
                      ))}
                    </p>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary btn-sm btn-full"
                    disabled={isJoined || busy === `community:${community.id}`}
                    onClick={() => joinCommunity(community)}
                  >
                    {isJoined
                      ? 'Joined'
                      : busy === `community:${community.id}`
                        ? 'Joining…'
                        : 'Join server'}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {players.length > 0 && (
        <section className="discover-section">
          <div className="discover-section-head">
            <div>
              <h2 className="section-heading">
                <SearchIcon size={17} /> Players who play your games
              </h2>
              <p className="discover-section-hint">
                Only shared games are shown. Follow if you want to see their posts.
              </p>
            </div>
          </div>
          <div className="discover-grid discover-grid-players">
            {players.map((player) => {
              const isFollowing = player.following || followed.has(player.username);
              return (
                <article key={player.id} className="discover-card discover-player-card">
                  <span className="discover-player-avatar">
                    {player.username.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="discover-player-info">
                    <h3>
                      <Link to={`/u/${player.username}`}>@{player.username}</Link>
                    </h3>
                    <p className="discover-meta">
                      Level {player.level} · {player.presence?.status || 'offline'}
                    </p>
                    <p className="discover-tags">
                      {player.sharedGames.map((game) => (
                        <span key={game} className="discover-tag">
                          {game}
                        </span>
                      ))}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={isFollowing || busy === `player:${player.username}`}
                    onClick={() => followPlayer(player)}
                  >
                    {isFollowing
                      ? 'Following'
                      : busy === `player:${player.username}`
                        ? '…'
                        : 'Follow'}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {tags.length > 0 && (
        <section className="discover-section">
          <div className="discover-section-head">
            <div>
              <h2 className="section-heading">Tags to follow</h2>
              <p className="discover-section-hint">Recent conversations around your games.</p>
            </div>
          </div>
          <div className="discover-tag-cloud">
            {tags.map((tag) => (
              <Link
                key={tag.tag}
                to={`/c/${encodeURIComponent(tag.tag)}`}
                className="discover-tag discover-tag-link"
              >
                #{tag.tag} <span>{tag.postCount}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default DiscoveryBoard;
