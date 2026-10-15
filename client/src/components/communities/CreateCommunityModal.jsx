import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import axiosInstance from '../../api/axiosInstance';

const CreateCommunityModal = ({ isOpen, onClose, onCreated }) => {
  const [name, setName]             = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon]             = useState('🎮');
  const [isPrivate, setIsPrivate]   = useState(false);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  const ICON_PRESETS = ['🎮', '🏆', '⚔️', '🔫', '🧙', '🚀', '🐉', '🦊', '💀', '🌐', '🎯', '🔥'];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || name.trim().length < 3) {
      setError('Community name must be at least 3 characters.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { data } = await axiosInstance.post('/communities', {
        name: name.trim(),
        description: description.trim(),
        icon,
        isPrivate
      });
      onCreated(data);
      onClose();
      setName(''); setDescription(''); setIcon('🎮'); setIsPrivate(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create community.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h2 className="modal-title" style={{ margin: 0 }}>🏰 Create a Community</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
        </div>

        {error && <div className="auth-error" style={{ marginBottom: '1rem' }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          {/* Icon Picker */}
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">Community Icon</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.3rem' }}>
              {ICON_PRESETS.map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setIcon(emoji)}
                  style={{
                    fontSize: '1.5rem', padding: '0.25rem 0.5rem',
                    background: icon === emoji ? 'var(--accent)' : 'var(--bg-elevated)',
                    border: `2px solid ${icon === emoji ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: '8px', cursor: 'pointer'
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Community Name *</label>
            <input
              className="form-input"
              placeholder="e.g. Valorant Elite APAC"
              value={name}
              maxLength={40}
              onChange={e => setName(e.target.value)}
              required
            />
            <span className="text-muted" style={{ fontSize: '0.75rem' }}>{name.length}/40</span>
          </div>

          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea
              className="form-input"
              rows={3}
              placeholder="What is this community about? Who should join?"
              value={description}
              maxLength={200}
              onChange={e => setDescription(e.target.value)}
            />
            <span className="text-muted" style={{ fontSize: '0.75rem' }}>{description.length}/200</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem' }}>
            <input
              type="checkbox"
              id="isPrivate"
              checked={isPrivate}
              onChange={e => setIsPrivate(e.target.checked)}
              style={{ width: '16px', height: '16px', accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
            <label htmlFor="isPrivate" style={{ cursor: 'pointer', fontSize: '0.9rem' }}>
              🔒 Private Community <span className="text-muted" style={{ fontSize: '0.8rem' }}>(only visible to members)</span>
            </label>
          </div>

          <p className="text-muted" style={{ fontSize: '0.8rem', marginBottom: '1.25rem' }}>
            A <strong>#general</strong> channel will be created automatically.
          </p>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating...' : `${icon} Create Community`}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

export default CreateCommunityModal;
