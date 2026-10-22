import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import axiosInstance from '../../api/axiosInstance';
import { useAuth } from '../../context/AuthContext';

const SLOT_OPTIONS = [2, 3, 4, 5, 6];
const ACTIVITY_SUGGESTIONS = ['Ranked Competitive', 'Casual Fun', 'Raid', 'Co-op Story', 'Scrims'];

const emptyForm = {
  gameTitle: '',
  gameThumbnail: null,
  activity: '',
  maxSlots: 5,
  minRank: '',
  micRequired: false
};

const CreatePartyModal = ({ isOpen, onClose, onCreated }) => {
  const { user } = useAuth();
  const [form, setForm] = useState(emptyForm);
  const [catalog, setCatalog] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setForm({ ...emptyForm, gameTitle: user?.preferences?.favoriteGames?.[0] || '' });
    setError('');

    let cancelled = false;
    axiosInstance.get('/games?limit=60')
      .then(({ data }) => { if (!cancelled) setCatalog(Array.isArray(data.games) ? data.games : []); })
      .catch(() => { if (!cancelled) setCatalog([]); });

    return () => { cancelled = true; };
  }, [isOpen]);

  if (!isOpen) return null;

  const set = (patch) => setForm(prev => ({ ...prev, ...patch }));

  const onGameTitle = (value) => {
    const match = catalog.find(g => g.title.toLowerCase() === value.trim().toLowerCase());
    set({ gameTitle: value, gameThumbnail: match?.thumbnail || null });
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const { data } = await axiosInstance.post('/lfg', {
        gameTitle: form.gameTitle,
        gameThumbnail: form.gameThumbnail,
        activity: form.activity,
        maxSlots: Number(form.maxSlots),
        requirements: { minRank: form.minRank, micRequired: form.micRequired }
      });
      onCreated?.(data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not create this squad.');
    } finally {
      setSaving(false);
    }
  };

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="create-party-title">
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
        <div className="modal-header-row">
          <h2 id="create-party-title" className="modal-title" style={{ margin: 0 }}>🎯 Recruit a squad</h2>
          <button onClick={onClose} className="modal-close" aria-label="Close">✕</button>
        </div>

        {error && <div className="form-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}

        <form onSubmit={submit}>
          <div className="form-group">
            <label className="form-label" htmlFor="party-game">Game</label>
            <input
              id="party-game"
              className="form-input"
              list="party-game-options"
              value={form.gameTitle}
              maxLength={60}
              required
              placeholder="Valorant, Apex Legends, Overwatch 2…"
              onChange={e => onGameTitle(e.target.value)}
            />
            <datalist id="party-game-options">
              {catalog.slice(0, 40).map(game => (
                <option key={game.id} value={game.title} />
              ))}
            </datalist>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="party-activity">Activity</label>
            <input
              id="party-activity"
              className="form-input"
              list="party-activity-options"
              value={form.activity}
              maxLength={60}
              placeholder="Ranked Competitive, Casual Fun…"
              onChange={e => set({ activity: e.target.value })}
            />
            <datalist id="party-activity-options">
              {ACTIVITY_SUGGESTIONS.map(activity => <option key={activity} value={activity} />)}
            </datalist>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label" htmlFor="party-slots">Squad size</label>
              <select
                id="party-slots"
                className="form-input"
                value={form.maxSlots}
                onChange={e => set({ maxSlots: Number(e.target.value) })}
              >
                {SLOT_OPTIONS.map(slots => (
                  <option key={slots} value={slots}>{slots} players</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="party-rank">Minimum rank</label>
              <input
                id="party-rank"
                className="form-input"
                value={form.minRank}
                maxLength={20}
                placeholder="Diamond+ (optional)"
                onChange={e => set({ minRank: e.target.value })}
              />
            </div>
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.micRequired}
              onChange={e => set({ micRequired: e.target.checked })}
            />
            🎙️ Mic required
          </label>

          <p className="text-muted" style={{ fontSize: '0.74rem', marginTop: '0.5rem' }}>
            Your squad stays on the board for 6 hours.
          </p>

          <div className="modal-footer" style={{ marginTop: '1rem' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create squad'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

export default CreatePartyModal;
