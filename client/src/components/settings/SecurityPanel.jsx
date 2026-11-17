import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axiosInstance from '../../api/axiosInstance';
import { useAuth } from '../../context/AuthContext';
import GoogleLinkButton from './GoogleLinkButton';
import { AlertIcon, CheckIcon, LockIcon, MailIcon } from '../common/icons';

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
  const [verifyNotice, setVerifyNotice] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    password: '',
    confirm: ''
  });

  const googleLinked = (account.providers || []).includes('google');
  const lastReset = formatDate(account.feedResetAt);
  const emailVerified = account.emailVerified === true;
  const hasLocalPassword = account.hasLocalPassword !== false;

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

  const resendVerification = async () => {
    setBusy('verify');
    setVerifyNotice('');
    try {
      await axiosInstance.post('/auth/verify-email/resend');
      setVerifyNotice('Verification email sent. Check your inbox.');
    } catch (err) {
      setVerifyNotice(err.response?.data?.message || 'Could not send that email right now.');
    } finally {
      setBusy(null);
    }
  };

  const updatePasswordField = (event) => {
    setPasswordForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const changePassword = async (event) => {
    event.preventDefault();
    setPasswordError('');
    if (!emailVerified) {
      setPasswordError('Verify your email before changing your password.');
      return;
    }
    if (passwordForm.password.length < 8) {
      setPasswordError('Password must be at least 8 characters.');
      return;
    }
    if (passwordForm.password !== passwordForm.confirm) {
      setPasswordError('Those passwords do not match.');
      return;
    }

    setPasswordBusy(true);
    try {
      await axiosInstance.patch('/auth/password', {
        ...(hasLocalPassword ? { currentPassword: passwordForm.currentPassword } : {}),
        password: passwordForm.password
      });
      await logout();
      navigate('/login', {
        state: { notice: 'Password changed. Sign in again with your new password.' }
      });
    } catch (err) {
      setPasswordError(err.response?.data?.message || 'Could not change the password.');
    } finally {
      setPasswordBusy(false);
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
          <h3><MailIcon size={15} /> Email verification</h3>
          <p>
            Confirming your email proves you own the address and lets you change your
            password. Existing accounts were verified when this feature launched.
          </p>
        </div>

        <div className="settings-auth-row">
          <div>
            <strong>{account.email}</strong>
            <span>
              {emailVerified
                ? 'Verified. Password changes are unlocked.'
                : 'Not verified. Check your inbox for the confirmation link.'}
            </span>
          </div>
          <div className="settings-actions">
            <span className={`settings-chip${emailVerified ? ' is-good' : ''}`}>
              {emailVerified ? <><CheckIcon size={13} /> Verified</> : 'Unverified'}
            </span>
            {!emailVerified && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={resendVerification}
                disabled={busy === 'verify'}
              >
                {busy === 'verify' ? 'Sending…' : 'Resend email'}
              </button>
            )}
          </div>
        </div>

        {verifyNotice && <p className="settings-help-text">{verifyNotice}</p>}
      </section>

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
          <h3><LockIcon size={15} /> {hasLocalPassword ? 'Change password' : 'Set a password'}</h3>
          <p>
            {hasLocalPassword
              ? 'Changing your password signs out every other device. Your current session is closed too, so sign in again with the new password.'
              : 'This account signs in with Google. After verifying your email you can add a password as a second sign-in method.'}
          </p>
        </div>

        {!emailVerified && (
          <div className="notice notice-error settings-inline-notice">
            <span className="settings-inline-error">
              <AlertIcon size={13} /> Verify your email to unlock this form.
            </span>
          </div>
        )}

        <form className="settings-password-form" onSubmit={changePassword}>
          {hasLocalPassword && (
            <div className="form-group">
              <label className="form-label" htmlFor="settings-current-password">Current password</label>
              <input
                id="settings-current-password"
                className="form-input"
                type="password"
                name="currentPassword"
                autoComplete="current-password"
                value={passwordForm.currentPassword}
                onChange={updatePasswordField}
                required
              />
            </div>
          )}
          <div className="form-group">
            <label className="form-label" htmlFor="settings-new-password">New password</label>
            <input
              id="settings-new-password"
              className="form-input"
              type="password"
              name="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={passwordForm.password}
              onChange={updatePasswordField}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="settings-confirm-password">Confirm new password</label>
            <input
              id="settings-confirm-password"
              className="form-input"
              type="password"
              name="confirm"
              autoComplete="new-password"
              value={passwordForm.confirm}
              onChange={updatePasswordField}
              required
            />
          </div>
          {passwordError && <div className="form-error">{passwordError}</div>}
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={!emailVerified || passwordBusy}
          >
            {passwordBusy
              ? 'Saving…'
              : hasLocalPassword ? 'Change password' : 'Set password'}
          </button>
        </form>
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
