import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import axiosInstance from '../../api/axiosInstance';
import ConfirmModal from '../common/ConfirmModal';

const ICONS = ['🎮', '🏆', '⚔️', '🔫', '🧙', '🚀', '🐉', '🦊', '💀', '🌐', '🎯', '🔥'];

const CommunitySettingsModal = ({ isOpen, onClose, community, onSaved, onDeleted }) => {
  const [form, setForm] = useState({ name: '', description: '', icon: '🎮', isPrivate: false });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !community) return;
    setForm({
      name: community.name || '',
      description: community.description || '',
      icon: community.icon || '🎮',
      isPrivate: !!community.isPrivate
    });
    setError('');
    setConfirmDelete(false);
  }, [isOpen, community]);

  if (!isOpen || !community) return null;

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const { data } = await axiosInstance.patch(`/communities/${community._id}`, form);
      onSaved?.(data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save server settings.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    setError('');
    try {
      await axiosInstance.delete(`/communities/${community._id}`);
      setConfirmDelete(false);
      onDeleted?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not delete this server.');
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="server-settings-title">
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '460px' }}>
        <div className="modal-header-row">
          <h2 id="server-settings-title" className="modal-title" style={{ margin: 0 }}>⚙️ Server Settings</h2>
          <button onClick={onClose} className="modal-close" aria-label="Close">✕</button>
        </div>

        {error && <div className="form-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}

        <form onSubmit={save}>
          <div className="form-group">
            <label className="form-label">Server icon</label>
            <div className="icon-picker">
              {ICONS.map(icon => (
                <button
                  key={icon}
                  type="button"
                  className={`icon-pick${form.icon === icon ? ' active' : ''}`}
                  onClick={() => setForm(prev => ({ ...prev, icon }))}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="server-name">Name</label>
            <input
              id="server-name"
              className="form-input"
              value={form.name}
              maxLength={40}
              onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
            />
            <span className="text-muted" style={{ fontSize: '0.72rem' }}>
              The URL slug stays unchanged so existing links keep working.
            </span>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="server-description">Description</label>
            <textarea
              id="server-description"
              className="form-textarea"
              rows={3}
              maxLength={200}
              value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
            />
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.isPrivate}
              onChange={e => setForm(prev => ({ ...prev, isPrivate: e.target.checked }))}
            />
            🔒 Invite-only server (only members can see it)
          </label>

          <div className="modal-footer" style={{ marginTop: '1.25rem' }}>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => setConfirmDelete(true)}
              disabled={saving || deleting}
            >
              🗑️ Delete server
            </button>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </div>
        </form>

        <ConfirmModal
          isOpen={confirmDelete}
          title="Delete server"
          message={`Permanently delete “${community.name}”, its channels, every message and its audit log? This cannot be undone.`}
          confirmText="Delete server"
          isDanger
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      </div>
    </div>,
    document.body
  );
};

export default CommunitySettingsModal;
