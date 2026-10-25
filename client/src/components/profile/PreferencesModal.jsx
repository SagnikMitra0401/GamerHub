import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import axiosInstance from '../../api/axiosInstance';
import { useAuth } from '../../context/AuthContext';
import { CloseIcon } from '../common/icons';

const GENRE_OPTIONS = [
  'Shooter', 'RPG', 'Battle Royale', 'MOBA', 'Strategy', 'Racing',
  'Sports', 'MMO', 'Survival', 'Platformer', 'Fighting', 'Puzzle', 'Sandbox'
];
const PLATFORM_OPTIONS = ['PC', 'PlayStation', 'Xbox', 'Switch'];
const MAX_GAMES = 20;

const PreferencesModal = ({ isOpen, onClose }) => {
  const { user, updateUser } = useAuth();
  const [games, setGames] = useState([]);
  const [genres, setGenres] = useState([]);
  const [platforms, setPlatforms] = useState([]);
  const [gameInput, setGameInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!isOpen || !user) return;
    setGames(user.preferences?.favoriteGames || []);
    setGenres(user.preferences?.favoriteGenres || []);
    setPlatforms(user.preferences?.platforms || []);
    setGameInput('');
    setError('');
    setNotice('');
  }, [isOpen, user?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  const addGame = () => {
    const value = gameInput.trim();
    if (!value) return;
    if (games.some(g => g.toLowerCase() === value.toLowerCase())) { setGameInput(''); return; }
    if (games.length >= MAX_GAMES) { setError(`You can follow up to ${MAX_GAMES} games.`); return; }
    setGames(prev => [...prev, value]);
    setGameInput('');
  };

  const toggle = (list, setList, value) => {
    setList(list.includes(value) ? list.filter(v => v !== value) : [...list, value]);
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data } = await axiosInstance.patch('/users/me/preferences', {
        favoriteGames: games,
        favoriteGenres: genres,
        platforms
      });
      updateUser({ preferences: data.preferences });
      setNotice('Preferences saved.');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save your preferences.');
    } finally {
      setSaving(false);
    }
  };

  const syncBot = async () => {
    setSyncing(true);
    setError('');
    setNotice('');
    try {
      const { data } = await axiosInstance.post('/bot/sync-youtube');
      setNotice(
        data.created > 0
          ? `${data.created} new video ping${data.created === 1 ? '' : 's'} added to your notifications.`
          : 'No new videos since the last check.'
      );
    } catch (err) {
      setError(err.response?.data?.message || 'The gaming bot could not sync right now.');
    } finally {
      setSyncing(false);
    }
  };

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="prefs-title">
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px' }}>
        <div className="modal-header-row">
          <h2 id="prefs-title" className="modal-title" style={{ margin: 0 }}>Your interests</h2>
          <button onClick={onClose} className="modal-close" aria-label="Close"><CloseIcon size={16} /></button>
        </div>

        <p className="text-muted" style={{ fontSize: '0.78rem', marginBottom: '0.85rem' }}>
          These power your “For You” feed and the gaming bot that watches for new videos.
        </p>

        {error && <div className="form-error" style={{ marginBottom: '0.6rem' }}>{error}</div>}
        {notice && <div className="notice notice-success" style={{ marginBottom: '0.6rem' }}>{notice}</div>}

        <form onSubmit={save}>
          <div className="form-group">
            <label className="form-label" htmlFor="prefs-game-input">Favourite games</label>
            <div className="chip-input">
              <input
                id="prefs-game-input"
                className="form-input"
                value={gameInput}
                maxLength={60}
                placeholder="Type a game and press Enter"
                onChange={e => setGameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addGame(); }
                }}
              />
              <button type="button" className="btn btn-ghost btn-sm" onClick={addGame}>Add</button>
            </div>
            {games.length > 0 && (
              <div className="chip-list">
                {games.map(gameName => (
                  <button
                    key={gameName}
                    type="button"
                    className="tag-chip tag-chip-removable"
                    onClick={() => setGames(games.filter(g => g !== gameName))}
                    title="Remove"
                  >
                    {gameName}
                    <CloseIcon size={12} />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="form-group">
            <span className="form-label">Favourite genres</span>
            <div className="chip-list">
              {GENRE_OPTIONS.map(name => (
                <button
                  key={name}
                  type="button"
                  className={`tag-chip${genres.includes(name) ? ' active' : ''}`}
                  aria-pressed={genres.includes(name)}
                  onClick={() => toggle(genres, setGenres, name)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <span className="form-label">Platforms</span>
            <div className="chip-list">
              {PLATFORM_OPTIONS.map(name => (
                <button
                  key={name}
                  type="button"
                  className={`tag-chip${platforms.includes(name) ? ' active' : ''}`}
                  aria-pressed={platforms.includes(name)}
                  onClick={() => toggle(platforms, setPlatforms, name)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={syncBot}
              disabled={syncing}
              title="Fetch new videos for your favourite games"
            >
              {syncing ? 'Checking…' : 'Check for new videos'}
            </button>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

export default PreferencesModal;
