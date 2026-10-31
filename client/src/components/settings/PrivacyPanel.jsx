import React, { useEffect, useState } from 'react';
import axiosInstance from '../../api/axiosInstance';
import { AlertIcon, DownloadIcon, UsersIcon } from '../common/icons';

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

const PrivacyPanel = ({ account, refresh, notify }) => {
  const [settings, setSettings] = useState(account.privacySettings || {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    setSettings(account.privacySettings || {});
  }, [account.privacySettings]);

  const patch = (key, value) => setSettings((previous) => ({ ...previous, [key]: value }));

  const dirty = JSON.stringify(settings) !== JSON.stringify(account.privacySettings || {});

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const { data } = await axiosInstance.patch('/users/privacy-settings', settings);
      setSettings(data.privacySettings);
      await refresh();
      notify('success', 'Privacy settings saved.');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save your settings.');
    } finally {
      setSaving(false);
    }
  };

  const unblock = async (userId) => {
    setBusy(`unblock:${userId}`);
    setError('');
    try {
      await axiosInstance.delete(`/account/block/${userId}`);
      await refresh();
      notify('success', 'Player unblocked.');
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
      notify('success', 'Your data export has been downloaded.');
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

  return (
    <>
      <header className="settings-panel-head">
        <div>
          <h2 className="settings-panel-title">Privacy &amp; safety</h2>
          <p className="settings-panel-sub">
            Who can reach you, who can find you, and what we hold about you.
          </p>
        </div>
      </header>

      <section className="settings-section">
        <div className="settings-section-head">
          <h3>Invitations</h3>
          <p>
            These rules are enforced by the server before an invitation leaves the sender. A
            squad owner cannot bypass them.
          </p>
        </div>

        <div className="settings-grid-2">
          <label className="form-group" htmlFor="settings-squad-invites">
            <span className="form-label">Squad invitations</span>
            <select
              id="settings-squad-invites"
              className="form-input"
              value={settings.allowSquadInvites || 'anyone'}
              onChange={(event) => patch('allowSquadInvites', event.target.value)}
            >
              {INVITE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="form-group" htmlFor="settings-server-invites">
            <span className="form-label">Server invitations</span>
            <select
              id="settings-server-invites"
              className="form-input"
              value={settings.allowServerInvites || 'anyone'}
              onChange={(event) => patch('allowServerInvites', event.target.value)}
            >
              {INVITE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="form-group" htmlFor="settings-dm">
            <span className="form-label">Direct messages</span>
            <select
              id="settings-dm"
              className="form-input"
              value={settings.allowDirectMessages || 'mutual_follows'}
              onChange={(event) => patch('allowDirectMessages', event.target.value)}
            >
              {DM_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.discoverableInSearch !== false}
            onChange={(event) => patch('discoverableInSearch', event.target.checked)}
          />
          Appear in player search
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.showActivityStatus !== false}
            onChange={(event) => patch('showActivityStatus', event.target.checked)}
          />
          Show my activity status
        </label>

        {error && (
          <span className="settings-inline-error">
            <AlertIcon size={13} /> {error}
          </span>
        )}

        <div className="settings-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={save}
            disabled={saving || !dirty}
          >
            {saving ? 'Saving…' : 'Save privacy settings'}
          </button>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h3>
            <UsersIcon size={15} /> Blocked players
          </h3>
          <p>
            Blocking is mutual: neither account appears in the other's search, and invitations
            are refused without revealing who blocked whom.
          </p>
        </div>

        {(account.blockedUsers || []).length === 0 ? (
          <p className="settings-help">
            Nobody is blocked. Use the Block button on a profile to add someone here.
          </p>
        ) : (
          <ul className="settings-blocked-list">
            {account.blockedUsers.map((player) => (
              <li key={player._id}>
                <span className="settings-avatar settings-avatar-sm" aria-hidden="true">
                  {(player.username?.[0] || '?').toUpperCase()}
                </span>
                <div className="settings-blocked-name">
                  <strong>@{player.username}</strong>
                  <span>Level {player.level || 1}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy === `unblock:${player._id}`}
                  onClick={() => unblock(player._id)}
                >
                  {busy === `unblock:${player._id}` ? 'Unblocking…' : 'Unblock'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h3>
            <DownloadIcon size={15} /> Your data
          </h3>
          <p>
            A JSON copy of your account, posts, comments, communities, squads, invitations and
            notifications. It never contains another player's private data or your password
            hash.
          </p>
        </div>
        <div className="settings-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={exportData}
            disabled={busy === 'export'}
          >
            <DownloadIcon size={14} /> {busy === 'export' ? 'Preparing…' : 'Download my data'}
          </button>
        </div>
      </section>
    </>
  );
};

export default PrivacyPanel;
