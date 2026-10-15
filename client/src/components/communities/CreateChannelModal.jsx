import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import axiosInstance from '../../api/axiosInstance';

const CreateChannelModal = ({ isOpen, onClose, communityId, onCreated }) => {
  const [name, setName]                   = useState('');
  const [topic, setTopic]                 = useState('');
  const [type, setType]                   = useState('text');
  const [minRoleToRead, setMinRoleToRead]   = useState('member');
  const [minRoleToWrite, setMinRoleToWrite] = useState('member');
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState('');

  const ROLES = ['member', 'moderator', 'admin', 'owner'];
  const ROLE_LABELS = { member: '🎮 Member+', moderator: '⚔️ Moderator+', admin: '🛡️ Admin+', owner: '👑 Owner Only' };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanName = name.trim().toLowerCase().replace(/\s+/g, '-');
    if (!cleanName || !/^[a-z0-9-]+$/.test(cleanName)) {
      setError('Channel name must use lowercase letters, numbers, and hyphens only.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { data } = await axiosInstance.post(`/communities/${communityId}/channels`, {
        name: cleanName,
        topic: topic.trim(),
        type,
        minRoleToRead,
        minRoleToWrite
      });
      onCreated(data);
      onClose();
      setName(''); setTopic(''); setType('text');
      setMinRoleToRead('member'); setMinRoleToWrite('member');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create channel.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h2 className="modal-title" style={{ margin: 0 }}>💬 Create Channel</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
        </div>

        {error && <div className="auth-error" style={{ marginBottom: '1rem' }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Channel Type</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {['text', 'announcement'].map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`btn btn-sm ${type === t ? 'btn-primary' : 'btn-ghost'}`}
                >
                  {t === 'text' ? '💬 Text' : '📢 Announcement'}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Channel Name *</label>
            <input
              className="form-input"
              placeholder="e.g. ranked-lfg"
              value={name}
              maxLength={40}
              onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-\s]/g, ''))}
              required
            />
            <span className="text-muted" style={{ fontSize: '0.75rem' }}>
              Preview: #{name.trim().replace(/\s+/g, '-') || 'channel-name'}
            </span>
          </div>

          <div className="form-group">
            <label className="form-label">Topic / Description</label>
            <input
              className="form-input"
              placeholder="e.g. Find players for ranked queues"
              value={topic}
              maxLength={100}
              onChange={e => setTopic(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Who can READ this channel?</label>
            <select className="form-input" value={minRoleToRead} onChange={e => setMinRoleToRead(e.target.value)}>
              {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Who can WRITE in this channel?</label>
            <select className="form-input" value={minRoleToWrite} onChange={e => setMinRoleToWrite(e.target.value)}>
              {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating...' : '💬 Create Channel'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

export default CreateChannelModal;
