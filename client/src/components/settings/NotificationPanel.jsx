import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axiosInstance from '../../api/axiosInstance';
import { AlertIcon, BellIcon } from '../common/icons';

const ROWS = [
  {
    key: 'comments',
    label: 'Comments and replies',
    hint: 'When someone comments on your post or replies to your comment.'
  },
  {
    key: 'follows',
    label: 'New followers',
    hint: 'When another player follows you.'
  },
  {
    key: 'likes',
    label: 'Likes',
    hint: 'When your posts and comments reach a like milestone.'
  },
  {
    key: 'lfg',
    label: 'Squad activity',
    hint: 'Requests, acceptances and members leaving your squads.'
  },
  {
    key: 'bot',
    label: 'Gaming-bot picks',
    hint: 'New videos and finds for the games you follow.'
  }
];

const DEFAULTS = {
  comments: true,
  follows: true,
  likes: true,
  lfg: true,
  bot: true
};

const normalize = (raw) => ROWS.reduce((settings, row) => {
  settings[row.key] = typeof raw?.[row.key] === 'boolean' ? raw[row.key] : DEFAULTS[row.key];
  return settings;
}, {});

const NotificationPanel = ({ account, refresh, notify }) => {
  const [settings, setSettings] = useState(() => normalize(account.notificationSettings));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setSettings(normalize(account.notificationSettings));
  }, [account.notificationSettings]);

  const dirty = JSON.stringify(settings) !== JSON.stringify(normalize(account.notificationSettings));

  const toggle = (key) => setSettings((previous) => ({ ...previous, [key]: !previous[key] }));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const { data } = await axiosInstance.patch('/account/notification-settings', settings);
      setSettings(normalize(data.notificationSettings));
      await refresh();
      notify('success', 'Notification preferences saved.');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save your notification preferences.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <header className="settings-panel-head">
        <div>
          <h2 className="settings-panel-title">
            <BellIcon size={18} /> Notifications
          </h2>
          <p className="settings-panel-sub">
            Choose which activity reaches your notification history and the bell.
          </p>
        </div>
        <span className="settings-status">
          {Object.values(settings).filter(Boolean).length}/5 on
        </span>
      </header>

      <section className="settings-section">
        <div className="settings-section-head">
          <h3>In-app notifications</h3>
          <p>
            These switches are checked by the server when a notification is created, not just
            hidden by this browser. Turning one off stops new pings in that category; everything
            already in your history stays readable.
          </p>
        </div>

        <div className="notif-pref-list">
          {ROWS.map((row) => (
            <label className="notif-pref-row" key={row.key}>
              <span className="notif-pref-text">
                <strong>{row.label}</strong>
                <small>{row.hint}</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                className="notif-pref-switch"
                checked={settings[row.key]}
                onChange={() => toggle(row.key)}
                aria-label={row.label}
              />
            </label>
          ))}
        </div>

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
            {saving ? 'Saving…' : 'Save notification preferences'}
          </button>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h3>Your history</h3>
          <p>
            Every notification you receive is kept in one cursor-paged list. Open it from the
            bell or go straight to your full history.
          </p>
        </div>
        <div className="settings-actions">
          <Link className="btn btn-ghost btn-sm" to="/notifications">
            Open notification history
          </Link>
        </div>
      </section>
    </>
  );
};

export default NotificationPanel;
