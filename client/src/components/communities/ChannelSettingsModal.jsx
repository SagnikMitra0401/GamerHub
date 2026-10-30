import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import axiosInstance from '../../api/axiosInstance';
import ConfirmModal from '../common/ConfirmModal';
import { CloseIcon } from '../common/icons';
import { ROLE_LABELS } from '../../utils/permissions';

const ROLE_OPTIONS = ['member', 'moderator', 'admin', 'owner'];
const SLOWMODE_OPTIONS = [0, 5, 15, 30, 60, 120];
const RETENTION_OPTIONS = [0, 30, 60, 90, 180, 365];

const ChannelSettingsModal = ({ isOpen, onClose, communityId, channel, onSaved, onDeleted }) => {
  const [form, setForm] = useState({
    topic: '',
    type: 'text',
    minRoleToRead: 'member',
    minRoleToWrite: 'member',
    slowModeSeconds: 0,
    retentionDays: 0,
    isProtected: false
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !channel) return;
    setForm({
      topic: channel.topic || '',
      type: channel.type || 'text',
      minRoleToRead: channel.minRoleToRead || 'member',
      minRoleToWrite: channel.minRoleToWrite || 'member',
      slowModeSeconds: channel.slowModeSeconds || 0,
      retentionDays: channel.retentionDays || 0,
      isProtected: !!channel.isProtected
    });
    setError('');
    setDeleting(false);
    setConfirmDelete(false);
  }, [isOpen, channel]);

  if (!isOpen || !channel) return null;

  const set = (patch) => setForm(prev => ({ ...prev, ...patch }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const { data } = await axiosInstance.patch(
        `/communities/${communityId}/channels/${channel._id}`,
        form
      );
      onSaved?.(data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save this channel.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    setError('');
    try {
      await axiosInstance.delete(`/communities/${communityId}/channels/${channel._id}`);
      setConfirmDelete(false);
      onDeleted?.(channel._id);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not delete this channel.');
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="channel-settings-title">
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '460px' }}>
        <div className="modal-header-row">
          <h2 id="channel-settings-title" className="modal-title" style={{ margin: 0 }}>
            #{channel.name}
          </h2>
          <button onClick={onClose} className="modal-close" aria-label="Close"><CloseIcon size={16} /></button>
        </div>

        {error && <div className="form-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}

        <form onSubmit={save}>
          <div className="form-group">
            <label className="form-label" htmlFor="channel-topic">Topic</label>
            <input
              id="channel-topic"
              className="form-input"
              value={form.topic}
              maxLength={100}
              onChange={e => set({ topic: e.target.value })}
              placeholder="What is this channel about?"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="channel-type">Channel type</label>
            <select
              id="channel-type"
              className="form-input"
              value={form.type}
              onChange={e => set({ type: e.target.value })}
            >
              <option value="text">Text</option>
              <option value="announcement">Announcement (moderators can post)</option>
              <option value="forum">Forum (threaded posts)</option>
            </select>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label" htmlFor="channel-read">Who can read</label>
              <select
                id="channel-read"
                className="form-input"
                value={form.minRoleToRead}
                onChange={e => set({ minRoleToRead: e.target.value })}
              >
                {ROLE_OPTIONS.map(role => (
                  <option key={role} value={role}>{ROLE_LABELS[role]}+</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="channel-write">Who can write</label>
              <select
                id="channel-write"
                className="form-input"
                value={form.minRoleToWrite}
                onChange={e => set({ minRoleToWrite: e.target.value })}
              >
                {ROLE_OPTIONS.map(role => (
                  <option key={role} value={role}>{ROLE_LABELS[role]}+</option>
                ))}
              </select>
              <span className="text-muted" style={{ fontSize: '0.7rem' }}>
                Write is always at least the read level.
              </span>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label" htmlFor="channel-slowmode">Slowmode</label>
              <select
                id="channel-slowmode"
                className="form-input"
                value={form.slowModeSeconds}
                onChange={e => set({ slowModeSeconds: Number(e.target.value) })}
              >
                {SLOWMODE_OPTIONS.map(seconds => (
                  <option key={seconds} value={seconds}>
                    {seconds === 0 ? 'Off' : `${seconds} seconds`}
                  </option>
                ))}
              </select>
              <span className="text-muted" style={{ fontSize: '0.7rem' }}>
                Moderators bypass slowmode.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="channel-retention">Auto-delete history</label>
              <select
                id="channel-retention"
                className="form-input"
                value={form.retentionDays}
                onChange={e => set({ retentionDays: Number(e.target.value) })}
              >
                {RETENTION_OPTIONS.map(days => (
                  <option key={days} value={days}>
                    {days === 0 ? 'Keep forever' : `${days} days`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.isProtected}
              onChange={e => set({ isProtected: e.target.checked })}
            />
            Restrict copying/selecting channel content
          </label>

          <div className="modal-footer" style={{ marginTop: '1.25rem' }}>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => setConfirmDelete(true)}
              disabled={saving || deleting}
            >
              Delete channel
            </button>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save channel'}
              </button>
            </div>
          </div>
        </form>

        <ConfirmModal
          isOpen={confirmDelete}
          title="Delete channel"
          message={`Delete #${channel.name} and every message in it? This cannot be undone.`}
          confirmText="Delete"
          isDanger
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      </div>
    </div>,
    document.body
  );
};

export default ChannelSettingsModal;
