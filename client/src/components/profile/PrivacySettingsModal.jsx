import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axiosInstance from '../../api/axiosInstance';
import { useAuth } from '../../context/AuthContext';
import { CloseIcon, DownloadIcon, LockIcon, UsersIcon } from '../common/icons';

const INVITE_OPTIONS = [
  { value: 'anyone', label: 'Anyone' },
  { value: 'followers', label: 'People I follow' },
  { value: 'none', label: 'Nobody' }
];

const DM_OPTIONS = [
  { value: 'anyone', label: 'Anyone' },
  { value: 'mutual_follows', label: 'Mutual follows' },
  { value: 'none', label: 'Nobody' }
];

/**
 * Privacy & data.
 *
 * Every control here maps to a server-side check: the invitation engine reads
 * these settings, blocking is enforced in search and invitations, and the
 * export/deletion endpoints act on the caller's own account only.
 */
const PrivacySettingsModal = ({ isOpen, onClose }) => {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [settings, setSettings] = useState(null);
  const [blocked, setBlocked] = useState([]);
  const [status, setStatus] = useState('active');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await axiosInstance.get('/account');
      setSettings(data.privacySettings || {});
      setBlocked(Array.isArray(data.blockedUsers) ? data.blockedUsers : []);
      setStatus(data.status || 'active');
    } catch {
      setError('Could not load your privacy settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setNotice('');
    load();
  }, [isOpen, load]);

  const patch = (key, value) => setSettings(prev => ({ ...prev, [key]: value }));

  const save = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data } = await axiosInstance.patch('/users/privacy-settings', settings);
      setSettings(data.privacySettings);
      setNotice('Privacy settings saved.');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save your settings.');
    } finally {
      setSaving(false);
    }
  };

  const unblock = async (userId) => {
    setBusy(`unblock:${userId}`);
    try {
      await axiosInstance.delete(`/account/block/${userId}`);
      setBlocked(prev => prev.filter(user => user._id !== userId));
    } catch {
      setError('Could not unblock that player.');
    } finally {
      setBusy(null);
    }
  };

  const exportData = async () => {
    setBusy('export');
    setError('');
    try {
      const { data } = await axiosInstance.get('/account/data-export', { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'gamerhub-export.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice('Your export has been downloaded.');
    } catch (err) {
      setError(
        err.response?.status === 429
          ? 'You have requested an export recently. Try again later.'
          : 'Could not build your export.'
      );
    } finally {
      setBusy(null);
    }
  };

  const signOutEverywhere = async () => {
    if (!window.confirm('Sign out of every device? You will need to sign in again here.')) return;
    setBusy('logout-all');
    try {
      await axiosInstance.post('/auth/logout-all');
    } catch {
      // Even a failed request should not leave a stale local session.
    } finally {
      await logout();
      navigate('/login');
    }
  };

  const requestDeletion = async () => {
    if (!window.confirm('Schedule your account for deletion? You have 30 days to cancel.')) return;
    setBusy('delete');
    setError('');
    try {
      await axiosInstance.post('/account/deletion-request');
      setStatus('deletion_pending');
      setNotice('Your account is scheduled for deletion. Sign in within 30 days to cancel.');
      await logout();
      navigate('/login');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not schedule deletion.');
      setBusy(null);
    }
  };

  const cancelDeletion = async () => {
    setBusy('cancel-delete');
    setError('');
    try {
      await axiosInstance.post('/account/deletion-cancel');
      setStatus('active');
      setNotice('Deletion cancelled. Welcome back.');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not cancel deletion.');
    } finally {
      setBusy(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Privacy and data">
      <div className="modal-box privacy-box">
        <div className="modal-header-row">
          <div>
            <h2 className="modal-title">Privacy &amp; data</h2>
            <p className="text-muted">Who can reach you, and what we hold.</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close privacy settings">
            <CloseIcon />
          </button>
        </div>

        {error && <div className="form-error">{error}</div>}
        {notice && <div className="notice notice-success">{notice}</div>}

        {loading ? (
          <div className="spinner" />
        ) : (
          <>
            <section className="privacy-section">
              <h3 className="privacy-heading">Invitations</h3>

              <label className="form-group" htmlFor="privacy-squad">
                <span className="form-label">Who can invite me to a squad</span>
                <select
                  id="privacy-squad"
                  className="form-input"
                  value={settings?.allowSquadInvites || 'anyone'}
                  onChange={e => patch('allowSquadInvites', e.target.value)}
                >
                  {INVITE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="form-group" htmlFor="privacy-server">
                <span className="form-label">Who can invite me to a server</span>
                <select
                  id="privacy-server"
                  className="form-input"
                  value={settings?.allowServerInvites || 'anyone'}
                  onChange={e => patch('allowServerInvites', e.target.value)}
                >
                  {INVITE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="form-group" htmlFor="privacy-dm">
                <span className="form-label">Who can message me</span>
                <select
                  id="privacy-dm"
                  className="form-input"
                  value={settings?.allowDirectMessages || 'mutual_follows'}
                  onChange={e => patch('allowDirectMessages', e.target.value)}
                >
                  {DM_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings?.discoverableInSearch !== false}
                  onChange={e => patch('discoverableInSearch', e.target.checked)}
                />
                Appear in player search
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings?.showActivityStatus !== false}
                  onChange={e => patch('showActivityStatus', e.target.checked)}
                />
                Show my activity status
              </label>

              <div className="privacy-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : 'Save privacy settings'}
                </button>
              </div>
            </section>

            <section className="privacy-section">
              <h3 className="privacy-heading">
                <UsersIcon size={14} /> Blocked players
              </h3>
              {blocked.length === 0 ? (
                <p className="text-muted">Nobody is blocked. Block a player from their profile.</p>
              ) : (
                <ul className="blocked-list">
                  {blocked.map(user => (
                    <li key={user._id} className="blocked-row">
                      <span className="blocked-name">@{user.username}</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy === `unblock:${user._id}`}
                        onClick={() => unblock(user._id)}
                      >
                        Unblock
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="privacy-section">
              <h3 className="privacy-heading">
                <DownloadIcon size={14} /> Your data
              </h3>
              <p className="text-muted">
                Download a JSON copy of your profile, posts, squads and invitations.
              </p>
              <div className="privacy-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={exportData}
                  disabled={busy === 'export'}
                >
                  {busy === 'export' ? 'Preparing…' : 'Download my data'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={signOutEverywhere}
                  disabled={busy === 'logout-all'}
                >
                  <LockIcon size={13} /> Sign out everywhere
                </button>
              </div>
            </section>

            <section className="privacy-section danger-section">
              <h3 className="privacy-heading">Account</h3>
              {status === 'deletion_pending' ? (
                <>
                  <p className="text-muted">
                    This account is scheduled for deletion. Signing in again or cancelling stops the
                    erasure.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={cancelDeletion}
                    disabled={busy === 'cancel-delete'}
                  >
                    Cancel deletion
                  </button>
                </>
              ) : (
                <>
                  <p className="text-muted">
                    Deletes your profile, posts and squad history after a 30-day grace period.
                  </p>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={requestDeletion}
                    disabled={busy === 'delete'}
                  >
                    Delete my account
                  </button>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default PrivacySettingsModal;
