import React, { useEffect, useState } from 'react';
import axiosInstance from '../../api/axiosInstance';
import { AlertIcon, DownloadIcon, MailIcon, UsersIcon } from '../common/icons';

const INVITE_OPTIONS = [
  { value: 'anyone', label: 'Anyone' },
  { value: 'followers', label: 'People I follow' },
  { value: 'none', label: 'Nobody' }
];

const DM_ACTION_OPTIONS = [
  { value: 'inbox', label: 'Open inbox' },
  { value: 'request', label: 'Request first' },
  { value: 'verified', label: 'Verified only' },
  { value: 'none', label: 'Nobody' }
];

const DM_POLICY_ROWS = [
  { key: 'mutual', label: 'Mutual follows', hint: 'You follow each other' },
  { key: 'follower', label: 'People who follow you', hint: 'They follow you; you may not follow back' },
  { key: 'following', label: 'People you follow', hint: 'You follow them' },
  { key: 'community', label: 'Shared server members', hint: 'Outside your follow graph' },
  { key: 'squad', label: 'Squad mates', hint: 'Outside your follow graph' },
  { key: 'business', label: 'Business accounts', hint: 'Disclosed business profiles' },
  { key: 'stranger', label: 'Everyone else', hint: 'No shared server, squad or follow' }
];

const DM_DEFAULTS = {
  policy: {
    mutual: 'inbox',
    follower: 'request',
    following: 'request',
    community: 'request',
    squad: 'request',
    business: 'request',
    stranger: 'request'
  },
  digest: 'daily',
  quietHours: { enabled: false, start: '22:00', end: '07:00', timezone: 'UTC' },
  readReceipts: false,
  hiddenWords: [],
  availability: 'open',
  awayMessage: '',
  quickReplies: []
};

const PrivacyPanel = ({ account, refresh, notify }) => {
  const [settings, setSettings] = useState(account.privacySettings || {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [dmSettings, setDmSettings] = useState(account.dmSettings || DM_DEFAULTS);
  const [hiddenWordsText, setHiddenWordsText] = useState('');
  const [quickRepliesText, setQuickRepliesText] = useState('');
  const [savingDm, setSavingDm] = useState(false);
  const [dmError, setDmError] = useState('');

  useEffect(() => {
    setSettings(account.privacySettings || {});
  }, [account.privacySettings]);

  useEffect(() => {
    const next = account.dmSettings || DM_DEFAULTS;
    setDmSettings(next);
    setHiddenWordsText((next.hiddenWords || []).join(', '));
    setQuickRepliesText((next.quickReplies || []).join('\n'));
  }, [account.dmSettings]);

  const patch = (key, value) => setSettings((previous) => ({ ...previous, [key]: value }));
  const patchDmPolicy = (key, value) => setDmSettings((previous) => ({
    ...previous,
    policy: { ...(previous.policy || DM_DEFAULTS.policy), [key]: value }
  }));
  const patchQuietHours = (key, value) => setDmSettings((previous) => ({
    ...previous,
    quietHours: {
      ...DM_DEFAULTS.quietHours,
      ...(previous.quietHours || {}),
      [key]: value
    }
  }));

  const dirty = JSON.stringify(settings) !== JSON.stringify(account.privacySettings || {});
  const dmDirty =
    JSON.stringify(dmSettings) !== JSON.stringify(account.dmSettings || DM_DEFAULTS) ||
    hiddenWordsText !== ((account.dmSettings || DM_DEFAULTS).hiddenWords || []).join(', ') ||
    quickRepliesText !== ((account.dmSettings || DM_DEFAULTS).quickReplies || []).join('\n');

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

  const saveDm = async () => {
    setSavingDm(true);
    setDmError('');
    try {
      const payload = {
        ...dmSettings,
        hiddenWords: hiddenWordsText.split(',').map((word) => word.trim()).filter(Boolean),
        quickReplies: quickRepliesText.split('\n').map((reply) => reply.trim()).filter(Boolean)
      };
      const { data } = await axiosInstance.patch('/account/dm-settings', payload);
      setDmSettings(data.dmSettings);
      setHiddenWordsText((data.dmSettings?.hiddenWords || []).join(', '));
      setQuickRepliesText((data.dmSettings?.quickReplies || []).join('\n'));
      await refresh();
      notify('success', 'Message rules saved.');
    } catch (err) {
      setDmError(err.response?.data?.message || 'Could not save your message rules.');
    } finally {
      setSavingDm(false);
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
            <MailIcon size={15} /> Direct messages
          </h3>
          <p>
            First contact is a request unless you open the inbox for that relationship. These
            rules are checked on the server before a conversation is created.
          </p>
        </div>

        <div className="dm-matrix">
          <div className="dm-matrix-head" aria-hidden="true">
            <span>Relationship</span>
            <span>First contact</span>
          </div>
          {DM_POLICY_ROWS.map((row) => (
            <label className="dm-matrix-row" key={row.key} htmlFor={`dm-policy-${row.key}`}>
              <span className="dm-matrix-label">
                <strong>{row.label}</strong>
                <small>{row.hint}</small>
              </span>
              <select
                id={`dm-policy-${row.key}`}
                className="form-input"
                value={(dmSettings.policy || DM_DEFAULTS.policy)[row.key] || DM_DEFAULTS.policy[row.key]}
                onChange={(event) => patchDmPolicy(row.key, event.target.value)}
              >
                {DM_ACTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <p className="settings-help">
          Verified means a linked Google account with a verified email. Requests expire after 14
          days; a declined or ignored request starts a 90-day cooldown.
        </p>

        <div className="settings-grid-2 dm-settings-grid">
          <label className="form-group" htmlFor="dm-availability">
            <span className="form-label">Inbox availability</span>
            <select
              id="dm-availability"
              className="form-input"
              value={dmSettings.availability || 'open'}
              onChange={(event) => setDmSettings((previous) => ({ ...previous, availability: event.target.value }))}
            >
              <option value="open">Open</option>
              <option value="away">Away notice</option>
              <option value="paused">Paused</option>
            </select>
          </label>
          <label className="form-group" htmlFor="dm-away-message">
            <span className="form-label">Away message</span>
            <input
              id="dm-away-message"
              className="form-input"
              value={dmSettings.awayMessage || ''}
              onChange={(event) => setDmSettings((previous) => ({ ...previous, awayMessage: event.target.value.slice(0, 200) }))}
              placeholder="Back after the weekend"
              maxLength={200}
            />
          </label>
        </div>
        <p className="settings-help">
          Paused refuses new requests but leaves every accepted conversation open. Away keeps
          requests open and shows your note on your profile and in the request composer.
        </p>

        <label className="form-group" htmlFor="dm-quick-replies">
          <span className="form-label">Quick replies</span>
          <textarea
            id="dm-quick-replies"
            className="form-input"
            value={quickRepliesText}
            onChange={(event) => setQuickRepliesText(event.target.value)}
            placeholder={'Thanks, I will take a look.\nNot taking collabs this month.\nSend your brief through the business email.'}
            rows={4}
          />
          <span className="settings-help">
            One per line, up to five. They appear above the composer in accepted threads.
          </span>
        </label>

        <div className="settings-grid-2 dm-settings-grid">
          <label className="form-group" htmlFor="dm-digest">
            <span className="form-label">Message digest</span>
            <select
              id="dm-digest"
              className="form-input"
              value={dmSettings.digest || 'daily'}
              onChange={(event) => setDmSettings((previous) => ({ ...previous, digest: event.target.value }))}
            >
              <option value="off">Off</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>
          <label className="checkbox-row dm-checkbox-card" htmlFor="dm-read-receipts">
            <input
              id="dm-read-receipts"
              type="checkbox"
              checked={dmSettings.readReceipts === true}
              onChange={(event) => setDmSettings((previous) => ({ ...previous, readReceipts: event.target.checked }))}
            />
            Read receipts after acceptance
          </label>
        </div>

        <div className="settings-grid-2 dm-settings-grid">
          <label className="checkbox-row dm-checkbox-card" htmlFor="dm-quiet-enabled">
            <input
              id="dm-quiet-enabled"
              type="checkbox"
              checked={dmSettings.quietHours?.enabled === true}
              onChange={(event) => patchQuietHours('enabled', event.target.checked)}
            />
            Quiet hours
          </label>
          <label className="form-group" htmlFor="dm-quiet-timezone">
            <span className="form-label">Quiet-hours timezone</span>
            <input
              id="dm-quiet-timezone"
              className="form-input"
              value={dmSettings.quietHours?.timezone || 'UTC'}
              onChange={(event) => patchQuietHours('timezone', event.target.value.slice(0, 60))}
              placeholder="Europe/London"
              maxLength={60}
            />
          </label>
          <label className="form-group" htmlFor="dm-quiet-start">
            <span className="form-label">Quiet from</span>
            <input
              id="dm-quiet-start"
              className="form-input"
              type="time"
              value={dmSettings.quietHours?.start || '22:00'}
              onChange={(event) => patchQuietHours('start', event.target.value)}
            />
          </label>
          <label className="form-group" htmlFor="dm-quiet-end">
            <span className="form-label">Quiet until</span>
            <input
              id="dm-quiet-end"
              className="form-input"
              type="time"
              value={dmSettings.quietHours?.end || '07:00'}
              onChange={(event) => patchQuietHours('end', event.target.value)}
            />
          </label>
        </div>
        <p className="settings-help">
          During quiet hours a new message is still stored, but no live notification is pushed.
          An overnight window such as 22:00–07:00 works as expected. Invalid timezones fall back
          to UTC when saved.
        </p>

        <label className="form-group" htmlFor="dm-hidden-words">
          <span className="form-label">Hidden words</span>
          <input
            id="dm-hidden-words"
            className="form-input"
            value={hiddenWordsText}
            onChange={(event) => setHiddenWordsText(event.target.value)}
            placeholder="spam, crypto, discord.gg"
          />
          <span className="settings-help">
            Comma separated, up to 50. A first message containing one goes to Filtered instead
            of Requests; the sender is not told.
          </span>
        </label>

        {dmError && (
          <span className="settings-inline-error">
            <AlertIcon size={13} /> {dmError}
          </span>
        )}

        <div className="settings-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={saveDm}
            disabled={savingDm || !dmDirty}
          >
            {savingDm ? 'Saving…' : 'Save message rules'}
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
