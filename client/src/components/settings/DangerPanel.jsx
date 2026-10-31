import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axiosInstance from '../../api/axiosInstance';
import { useAuth } from '../../context/AuthContext';
import { AlertIcon, CheckIcon, LockIcon, TrashIcon, UsersIcon } from '../common/icons';

const formatDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const DangerPanel = ({ account, refresh, notify }) => {
  const { user, fetchMe, logout } = useAuth();
  const navigate = useNavigate();

  const frozen = account.status === 'frozen';
  const pendingDeletion = account.status === 'deletion_pending';

  const [mode, setMode] = useState(null); // freeze | schedule | now | null
  const [password, setPassword] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const [preview, setPreview] = useState({ loading: false, data: null, error: '' });

  const requiresPassword = account.hasLocalPassword !== false;
  const nameMatches = confirmName.trim().toLowerCase() === String(account.username || '').toLowerCase();
  const credentialReady = requiresPassword ? password.length > 0 : true;

  const resetForms = () => {
    setPassword('');
    setConfirmName('');
    setAcknowledged(false);
    setError('');
  };

  const openMode = (next) => {
    resetForms();
    setMode((current) => (current === next ? null : next));
    if (next === 'now' && !preview.data && !preview.loading) {
      setPreview({ loading: true, data: null, error: '' });
      axiosInstance.get('/account/succession-preview')
        .then(({ data }) => setPreview({ loading: false, data, error: '' }))
        .catch(() => setPreview({
          loading: false,
          data: null,
          error: 'Could not preview what happens to your servers and squads.'
        }));
    }
  };

  const freezeBody = () => {
    const body = { frozen: !frozen };
    if (requiresPassword) body.password = password;
    else body.confirmUsername = confirmName;
    return body;
  };

  const submitFreeze = async () => {
    setBusy('freeze');
    setError('');
    try {
      await axiosInstance.post('/account/freeze', freezeBody());
      await refresh();
      await fetchMe();
      setMode(null);
      resetForms();
      notify(
        'success',
        frozen
          ? 'Account unfrozen. Your content is visible again.'
          : 'Account frozen. Your content is hidden and participation is paused.'
      );
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update your account state.');
    } finally {
      setBusy(null);
    }
  };

  const scheduleDeletion = async () => {
    setBusy('schedule');
    setError('');
    try {
      await axiosInstance.post('/account/deletion-request');
      await logout();
      navigate('/login');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not schedule deletion.');
      setBusy(null);
    }
  };

  const deleteNow = async () => {
    setBusy('delete');
    setError('');
    try {
      await axiosInstance.post('/account/delete-now', {
        confirmUsername: confirmName.trim(),
        ...(requiresPassword ? { password } : {})
      });
      // The cookie is cleared server-side; reload so no stale session survives.
      window.location.href = '/login?deleted=1';
    } catch (err) {
      setError(err.response?.data?.message || 'Could not delete this account.');
      setBusy(null);
    }
  };

  const cancelDeletion = async () => {
    setBusy('cancel');
    setError('');
    try {
      await axiosInstance.post('/account/deletion-cancel');
      await fetchMe();
      await refresh();
      notify('success', 'Deletion cancelled. Welcome back.');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not cancel deletion.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <header className="settings-panel-head">
        <div>
          <h2 className="settings-panel-title">Danger zone</h2>
          <p className="settings-panel-sub">
            Stealth mode, account deletion, and what happens to the servers and squads you own.
          </p>
        </div>
        <span className={`settings-status${frozen ? ' is-warn' : ''}`}>
          {frozen ? 'Frozen' : pendingDeletion ? 'Deletion scheduled' : 'Active'}
        </span>
      </header>

      {error && (
        <div className="notice notice-error">
          <span className="settings-inline-error">
            <AlertIcon size={13} /> {error}
          </span>
        </div>
      )}

      {pendingDeletion && (
        <section className="settings-section settings-callout is-warn">
          <div className="settings-section-head">
            <h3>Deletion is scheduled</h3>
            <p>
              Requested on {formatDate(account.deletionRequestedAt)}. The account is erased after{' '}
              {account.deletionGraceDays || 30} days. Signing in or cancelling now stops the erasure.
            </p>
          </div>
          <div className="settings-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={cancelDeletion}
              disabled={busy === 'cancel'}
            >
              {busy === 'cancel' ? 'Cancelling…' : 'Cancel deletion'}
            </button>
          </div>
        </section>
      )}

      <section className="settings-section settings-freeze-card">
        <div className="settings-section-head">
          <h3>
            <LockIcon size={15} /> {frozen ? 'Account is frozen' : 'Freeze account'}
          </h3>
          <p>
            Freezing is a reversible stealth mode. Your posts disappear from feeds, search and
            your public profile, your presence reads offline, invitations are refused, and you
            cannot post, react, join servers or send squad messages. Your account, data and
            memberships are kept.
          </p>
        </div>

        <ul className="settings-bullet-list">
          <li><CheckIcon size={13} /> Content hidden from everyone else while frozen</li>
          <li><CheckIcon size={13} /> Existing servers, squads and chats are not deleted</li>
          <li><CheckIcon size={13} /> Unfreeze at any time with the same confirmation</li>
        </ul>

        {mode === 'freeze' ? (
          <div className="settings-confirm">
            <strong>{frozen ? 'Unfreeze this account?' : 'Freeze this account?'}</strong>
            <p>
              {requiresPassword
                ? 'Enter your password to confirm. This is the same check used for every destructive action.'
                : 'This account signs in with Google only. Type your username to confirm.'}
            </p>

            {requiresPassword ? (
              <label className="form-group" htmlFor="freeze-password">
                <span className="form-label">Password</span>
                <input
                  id="freeze-password"
                  type="password"
                  className="form-input"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </label>
            ) : (
              <label className="form-group" htmlFor="freeze-name">
                <span className="form-label">Type @{account.username}</span>
                <input
                  id="freeze-name"
                  className="form-input"
                  value={confirmName}
                  onChange={(event) => setConfirmName(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            )}

            <div className="settings-actions">
              <button
                type="button"
                className={frozen ? 'btn btn-primary btn-sm' : 'btn btn-danger btn-sm'}
                onClick={submitFreeze}
                disabled={
                  busy === 'freeze' ||
                  (requiresPassword ? !password : !nameMatches)
                }
              >
                {busy === 'freeze'
                  ? 'Working…'
                  : frozen ? 'Unfreeze account' : 'Freeze account'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => { setMode(null); resetForms(); }}
                disabled={busy === 'freeze'}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="settings-actions">
            <button
              type="button"
              className={frozen ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
              onClick={() => openMode('freeze')}
              disabled={pendingDeletion}
            >
              {frozen ? 'Unfreeze account' : 'Freeze account'}
            </button>
          </div>
        )}
      </section>

      {!pendingDeletion && (
        <section className="settings-section settings-danger-card">
          <div className="settings-section-head">
            <h3>
              <TrashIcon size={15} /> Delete account
            </h3>
            <p>
              Two paths. Scheduling gives you 30 days to change your mind. Immediate deletion
              erases the account now, after handing your servers and squads to their next owner.
            </p>
          </div>

          {mode === 'schedule' ? (
            <div className="settings-confirm">
              <strong>Schedule deletion in 30 days?</strong>
              <p>
                Your profiles and content stay readable until then. You can cancel from this page
                or by signing in. After 30 days the account is anonymised and your content is
                removed.
              </p>
              <div className="settings-actions">
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={scheduleDeletion}
                  disabled={busy === 'schedule'}
                >
                  {busy === 'schedule' ? 'Scheduling…' : 'Schedule deletion'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setMode(null)}
                  disabled={busy === 'schedule'}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="settings-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => openMode('schedule')}
              >
                Schedule deletion
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => openMode('now')}
              >
                Delete immediately
              </button>
            </div>
          )}

          {mode === 'now' && (
            <div className="settings-confirm is-danger">
              <strong>This cannot be undone</strong>
              <p>
                Your posts, comments, notifications, invitations, squad messages and sign-in
                methods are removed. The email is released, so registering again creates a fresh
                account with no history.
              </p>

              <div className="settings-section-head settings-preview-head">
                <h4><UsersIcon size={14} /> Succession preview</h4>
                {preview.loading && <span className="settings-help">Reading your servers and squads…</span>}
                {preview.error && <span className="settings-inline-error">{preview.error}</span>}
              </div>

              {preview.data && (
                <div className="settings-preview">
                  {preview.data.communities.length === 0 && preview.data.squads.length === 0 && (
                    <p className="settings-help">
                      You do not own a server or lead an active squad. Nothing needs a successor.
                    </p>
                  )}

                  {preview.data.communities.map((entry) => (
                    <div key={`community-${entry.id}`} className="settings-preview-row">
                      <span className="settings-preview-kind">Server</span>
                      <strong>{entry.name}</strong>
                      <span>
                        {entry.action === 'transfer'
                          ? `@${entry.successor?.username || 'a member'} takes over`
                          : 'No other members remain, so it will be dissolved'}
                      </span>
                    </div>
                  ))}

                  {preview.data.squads.map((entry) => (
                    <div key={`squad-${entry.id}`} className="settings-preview-row">
                      <span className="settings-preview-kind">Squad</span>
                      <strong>{entry.gameTitle}</strong>
                      <span>
                        {entry.action === 'transfer'
                          ? `@${entry.successor?.username || 'a member'} becomes leader`
                          : 'No other members remain, so it will be closed'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <label className="form-group" htmlFor="delete-name">
                <span className="form-label">Type @{account.username} to confirm</span>
                <input
                  id="delete-name"
                  className="form-input"
                  value={confirmName}
                  onChange={(event) => setConfirmName(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={account.username}
                />
              </label>

              {requiresPassword ? (
                <label className="form-group" htmlFor="delete-password">
                  <span className="form-label">Password</span>
                  <input
                    id="delete-password"
                    type="password"
                    className="form-input"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                  />
                </label>
              ) : (
                <p className="settings-help">
                  This account signs in with Google only. Your typed username is the confirmation.
                </p>
              )}

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                I understand this cannot be undone
              </label>

              <div className="settings-actions">
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={deleteNow}
                  disabled={
                    busy === 'delete' ||
                    !acknowledged ||
                    !nameMatches ||
                    !credentialReady
                  }
                >
                  {busy === 'delete' ? 'Deleting…' : 'Delete permanently'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setMode(null); resetForms(); }}
                  disabled={busy === 'delete'}
                >
                  Keep my account
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
};

export default DangerPanel;
