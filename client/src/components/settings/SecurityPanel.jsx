import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axiosInstance from '../../api/axiosInstance';
import { useAuth } from '../../context/AuthContext';
import GoogleLinkButton from './GoogleLinkButton';
import { AlertIcon, CheckIcon, LockIcon } from '../common/icons';

const formatDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const SecurityPanel = ({ account, refresh, notify }) => {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const googleLinked = (account.providers || []).includes('google');
  const lastReset = formatDate(account.feedResetAt);

  const unlinkGoogle = async () => {
    if (!window.confirm('Unlink Google from this account? You can link it again later.')) return;
    setBusy('unlink');
    setError('');
    try {
      await axiosInstance.delete('/auth/link-google');
      await refresh();
      notify('success', 'Google unlinked. Password sign-in still works.');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not unlink Google.');
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
      // Clearing the local session is what matters even if the request failed.
    } finally {
      await logout();
      navigate('/login');
    }
  };

  return (
    <>
      <header className="settings-panel-head">
        <div>
          <h2 className="settings-panel-title">Security &amp; auth</h2>
          <p className="settings-panel-sub">
            Connected sign-in methods and every session this account has open.
          </p>
        </div>
        <span className="settings-status is-good">
          <CheckIcon size={13} /> Signed in
        </span>
      </header>

      {error && (
        <div className="notice notice-error">
          <span className="settings-inline-error">
            <AlertIcon size={13} /> {error}
          </span>
        </div>
      )}

      <section className="settings-section">
        <div className="settings-section-head">
          <h3>Sign-in methods</h3>
          <p>
            Google is verified server-side on every sign-in. Linking is refused if the Google
            email differs from this account's email, so two identities cannot be mixed by
            accident.
          </p>
        </div>

        <div className="settings-auth-row">
          <div>
            <strong>Email and password</strong>
            <span>
              {account.hasLocalPassword
                ? account.email
                : 'Not set. This account signs in with Google.'}
            </span>
          </div>
          <span className={`settings-chip${account.hasLocalPassword ? ' is-good' : ''}`}>
            {account.hasLocalPassword ? 'Enabled' : 'Unavailable'}
          </span>
        </div>

        <div className="settings-auth-row">
          <div>
            <strong>Google</strong>
            <span>
              {googleLinked
                ? 'Linked. You can sign in with either method.'
                : 'Not linked to this account.'}
            </span>
          </div>
          {googleLinked ? (
            <div className="settings-actions">
              <span className="settings-chip is-good"><CheckIcon size={13} /> Connected</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={unlinkGoogle}
                disabled={busy === 'unlink' || account.hasLocalPassword === false}
                title={
                  account.hasLocalPassword === false
                    ? 'Set a password before unlinking Google'
                    : undefined
                }
              >
                {busy === 'unlink' ? 'Unlinking…' : 'Unlink'}
              </button>
            </div>
          ) : (
            <GoogleLinkButton
              onLinked={async () => {
                await refresh();
                notify('success', 'Google connected.');
              }}
              onError={setError}
            />
          )}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h3>
            <LockIcon size={15} /> Sessions
          </h3>
          <p>
            Every session carries a version. Signing out everywhere increments it, so cookies
            already issued on other devices stop working immediately. There is no server-side
            session list to leak.
          </p>
        </div>

        <div className="settings-auth-row">
          <div>
            <strong>This browser</strong>
            <span>Active now</span>
          </div>
          <span className="settings-chip is-good"><CheckIcon size={13} /> Current</span>
        </div>

        <div className="settings-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={signOutEverywhere}
            disabled={busy === 'logout-all'}
          >
            <LockIcon size={14} /> {busy === 'logout-all' ? 'Signing out…' : 'Sign out everywhere'}
          </button>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h3>Recent account activity</h3>
        </div>
        <dl className="settings-facts">
          <div>
            <dt>Account status</dt>
            <dd>{account.status}</dd>
          </div>
          <div>
            <dt>Last recommendation reset</dt>
            <dd>{lastReset || 'Never'}</dd>
          </div>
          <div>
            <dt>Deletion requested</dt>
            <dd>{formatDate(account.deletionRequestedAt) || 'No'}</dd>
          </div>
        </dl>
      </section>
    </>
  );
};

export default SecurityPanel;
