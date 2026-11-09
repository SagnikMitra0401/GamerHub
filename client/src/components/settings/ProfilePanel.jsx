import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axiosInstance from '../../api/axiosInstance';
import EditPassportModal from '../profile/EditPassportModal';
import { PencilIcon, AlertIcon } from '../common/icons';

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const BIO_MAX = 300;

const STATUS_LABELS = {
  active: 'Active',
  restricted: 'Restricted',
  frozen: 'Frozen',
  suspended: 'Suspended',
  deletion_pending: 'Deletion scheduled',
  deleted: 'Deleted'
};

const formatDate = (value) => {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
};

const ProfilePanel = ({ account, user, updateUser, fetchMe, refresh, notify }) => {
  const [username, setUsername] = useState(user?.username || '');
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [usernameError, setUsernameError] = useState('');

  const [bio, setBio] = useState(user?.bio || '');
  const [bioSaving, setBioSaving] = useState(false);
  const [bioError, setBioError] = useState('');
  const [passportOpen, setPassportOpen] = useState(false);

  useEffect(() => {
    setUsername(user?.username || '');
    setBio(user?.bio || '');
  }, [user?.username, user?.bio]);

  const trimmed = username.trim();
  const usernameChanged = trimmed !== (user?.username || '');
  const usernameValid = USERNAME_PATTERN.test(trimmed);
  const usernameHint = !trimmed
    ? 'Pick the handle other players will see.'
    : !usernameValid
      ? '3–20 characters, letters, numbers and underscores only.'
      : !usernameChanged
        ? 'This is your current handle.'
        : 'Available to claim if somebody else has not taken it.';

  const saveUsername = async (event) => {
    event.preventDefault();
    if (!usernameValid || !usernameChanged) return;
    setUsernameSaving(true);
    setUsernameError('');
    try {
      const { data } = await axiosInstance.patch('/account/username', { username: trimmed });
      updateUser({ username: data.username });
      await Promise.all([fetchMe(), refresh()]);
      notify('success', `Your handle is now @${data.username}.`);
    } catch (err) {
      setUsernameError(err.response?.data?.message || 'Could not change your username.');
    } finally {
      setUsernameSaving(false);
    }
  };

  const saveBio = async (event) => {
    event.preventDefault();
    if (bio === (user?.bio || '')) return;
    setBioSaving(true);
    setBioError('');
    try {
      const { data } = await axiosInstance.patch('/auth/profile', { bio });
      updateUser({ bio: data.user?.bio ?? bio });
      notify('success', 'Bio updated.');
    } catch (err) {
      setBioError(err.response?.data?.message || 'Could not save your bio.');
    } finally {
      setBioSaving(false);
    }
  };

  const savePassport = async (passport) => {
    const { data } = await axiosInstance.put('/users/me/passport', passport);
    updateUser({ gamerPassport: data });
    setPassportOpen(false);
    notify('success', 'Gaming passport updated.');
  };

  const initial = (user?.username?.[0] || '?').toUpperCase();

  return (
    <>
      <header className="settings-panel-head">
        <div>
          <h2 className="settings-panel-title">Profile &amp; identity</h2>
          <p className="settings-panel-sub">
            How you appear across the feed, servers and squads.
          </p>
        </div>
        <span className={`settings-status is-${account.status === 'active' ? 'good' : 'warn'}`}>
          {STATUS_LABELS[account.status] || account.status}
        </span>
      </header>

      <section className="settings-identity">
        <span className="settings-avatar" aria-hidden="true">{initial}</span>
        <div className="settings-identity-text">
          <strong>@{user?.username}</strong>
          <span>
            {account.email} · Level {user?.level || 1} · Member since {formatDate(account.createdAt)}
          </span>
        </div>
        <Link to={`/u/${user?.username}`} className="btn btn-ghost btn-sm">
          View passport
        </Link>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h3>Username</h3>
          <p>
            Changing your handle keeps everything you have posted, earned and joined. Your
            profile URL changes with it.
          </p>
        </div>

        <form onSubmit={saveUsername} className="settings-form">
          <label className="form-group" htmlFor="settings-username">
            <span className="form-label">Handle</span>
            <div className="settings-input-prefix">
              <span aria-hidden="true">@</span>
              <input
                id="settings-username"
                className="form-input"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                maxLength={20}
                autoComplete="username"
                spellCheck={false}
              />
            </div>
            <span className={`settings-help${usernameValid ? '' : ' is-warn'}`}>{usernameHint}</span>
          </label>

          {usernameError && (
            <span className="settings-inline-error">
              <AlertIcon size={13} /> {usernameError}
            </span>
          )}

          <div className="settings-actions">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!usernameValid || !usernameChanged || usernameSaving}
            >
              {usernameSaving ? 'Saving…' : 'Update handle'}
            </button>
          </div>
        </form>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h3>Bio</h3>
          <p>Up to {BIO_MAX} characters. Plain text, shown on your profile.</p>
        </div>

        <form onSubmit={saveBio} className="settings-form">
          <label className="form-group" htmlFor="settings-bio">
            <span className="form-label">About you</span>
            <textarea
              id="settings-bio"
              className="form-input form-textarea"
              rows={4}
              maxLength={BIO_MAX}
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              placeholder="What do you play, and who do you play with?"
            />
            <span className="settings-help settings-count">
              {bio.length}/{BIO_MAX}
            </span>
          </label>

          {bioError && (
            <span className="settings-inline-error">
              <AlertIcon size={13} /> {bioError}
            </span>
          )}

          <div className="settings-actions">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={bio === (user?.bio || '') || bioSaving}
            >
              {bioSaving ? 'Saving…' : 'Save bio'}
            </button>
          </div>
        </form>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h3>Gaming passport</h3>
          <p>
            Riot, Steam, PSN, Xbox and Discord IDs, the games you are on right now, and the
            hardware you play on.
          </p>
        </div>
        <div className="settings-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setPassportOpen(true)}
          >
            <PencilIcon size={14} /> Edit passport
          </button>
        </div>
        {user?.gamerPassport?.customQuote && (
          <p className="settings-quote">“{user.gamerPassport.customQuote}”</p>
        )}
        {(user?.gamerPassport?.activeGames || []).length > 0 && (
          <div className="settings-chip-row">
            {user.gamerPassport.activeGames.slice(0, 5).map((game) => (
              <span className="settings-chip" key={`${game.gameName}-${game.platform}`}>
                {game.gameName}
                <small>{game.platform}</small>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h3>Account facts</h3>
        </div>
        <dl className="settings-facts">
          <div>
            <dt>Email</dt>
            <dd>{account.email}</dd>
          </div>
          <div>
            <dt>Handle</dt>
            <dd className="mono">@{account.username}</dd>
          </div>
          <div>
            <dt>Member since</dt>
            <dd>{formatDate(account.createdAt)}</dd>
          </div>
          <div>
            <dt>Sign-in</dt>
            <dd>
              {account.hasLocalPassword ? 'Email and password' : 'Google'}
              {account.providers?.includes('google') && account.hasLocalPassword ? ' + Google' : ''}
            </dd>
          </div>
        </dl>
      </section>

      <EditPassportModal
        isOpen={passportOpen}
        onClose={() => setPassportOpen(false)}
        initialPassport={user?.gamerPassport}
        onSave={savePassport}
      />
    </>
  );
};

export default ProfilePanel;
