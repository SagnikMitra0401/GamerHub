import React, { useEffect, useRef, useState } from 'react';
import axiosInstance from '../../api/axiosInstance';
import { useAuth } from '../../context/AuthContext';

const OPTIONS = [
  { key: 'online',    icon: '🟢', label: 'Online',    hint: 'Visible and available' },
  { key: 'in_game',   icon: '🟣', label: 'Playing',   hint: 'Show the game you are in' },
  { key: 'invisible', icon: '⚪', label: 'Invisible', hint: 'Appear offline to everyone' }
];

const metaFor = (status) => OPTIONS.find(o => o.key === status) || OPTIONS[0];

const PresencePill = () => {
  const { user, updateUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [pickingGame, setPickingGame] = useState(false);
  const [game, setGame] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setOpen(false);
        setPickingGame(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!user) return null;

  const status = user.presence?.status || 'online';
  const activeGame = user.presence?.activeGame || '';
  const meta = metaFor(status === 'offline' ? 'invisible' : status);

  const save = async (nextStatus, nextGame = '') => {
    setSaving(true);
    setError('');
    try {
      const { data } = await axiosInstance.patch('/users/presence', {
        status: nextStatus,
        activeGame: nextStatus === 'in_game' ? nextGame : ''
      });
      updateUser({ presence: data.presence });
      setOpen(false);
      setPickingGame(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update your status.');
    } finally {
      setSaving(false);
    }
  };

  const pickPlaying = () => {
    setGame(activeGame || (user.preferences?.favoriteGames || [])[0] || '');
    setPickingGame(true);
  };

  return (
    <div className="presence-wrap" ref={wrapRef}>
      <button
        type="button"
        className="presence-pill"
        aria-label="Set your presence"
        aria-expanded={open}
        onClick={() => { setOpen(v => !v); setPickingGame(false); setError(''); }}
      >
        <span aria-hidden="true">{meta.icon}</span>
        <span className="presence-label">
          {status === 'in_game' && activeGame ? activeGame : meta.label}
        </span>
      </button>

      {open && (
        <div className="presence-menu" role="menu">
          {!pickingGame ? (
            <>
              {OPTIONS.map(option => (
                <button
                  key={option.key}
                  type="button"
                  role="menuitem"
                  className={`presence-option${option.key === status ? ' active' : ''}`}
                  disabled={saving}
                  onClick={() => (option.key === 'in_game' ? pickPlaying() : save(option.key))}
                >
                  <span aria-hidden="true">{option.icon}</span>
                  <span className="presence-option-text">
                    <strong>
                      {option.key === 'in_game' && activeGame ? `Playing ${activeGame}` : option.label}
                    </strong>
                    <small>{option.hint}</small>
                  </span>
                </button>
              ))}
              {error && <div className="form-error" style={{ margin: '0.35rem 0.5rem' }}>{error}</div>}
            </>
          ) : (
            <div className="presence-game">
              <label className="form-label" htmlFor="presence-game-input">What are you playing?</label>
              <input
                id="presence-game-input"
                className="form-input"
                value={game}
                maxLength={60}
                autoFocus
                placeholder="e.g. Valorant"
                onChange={e => setGame(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && game.trim()) save('in_game', game.trim()); }}
              />
              {(user.preferences?.favoriteGames || []).length > 0 && (
                <div className="presence-suggestions">
                  {user.preferences.favoriteGames.slice(0, 5).map(fav => (
                    <button
                      key={fav}
                      type="button"
                      className="tag-chip"
                      onClick={() => setGame(fav)}
                    >
                      {fav}
                    </button>
                  ))}
                </div>
              )}
              {error && <div className="form-error">{error}</div>}
              <div className="presence-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPickingGame(false)}>
                  Back
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={saving || !game.trim()}
                  onClick={() => save('in_game', game.trim())}
                >
                  {saving ? 'Saving…' : 'Set status'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PresencePill;
