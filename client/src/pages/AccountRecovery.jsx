import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';

/**
 * Account recovery through the backup address.
 *
 * Both steps answer the same way whether or not the handle and address match an
 * account, so this page cannot be used to check who has a recovery email.
 */
const AccountRecovery = () => {
  const navigate = useNavigate();
  const { fetchMe } = useAuth();
  const [stage, setStage] = useState('start');
  const [form, setForm] = useState({ username: '', recoveryEmail: '' });
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (event) => setForm({ ...form, [event.target.name]: event.target.value });

  const start = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data } = await axiosInstance.post('/auth/recovery/start', form);
      setNotice(data?.message || 'If those details match, a code is on its way.');
      setStage('verify');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not start recovery right now.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event) => {
    event.preventDefault();
    setError('');

    if (!/^\d{8}$/.test(code)) {
      setError('Enter the 8 digits from the email.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Those passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      await axiosInstance.post('/auth/recovery/verify', {
        username: form.username,
        code,
        newPassword: password,
      });
      // Recovery revokes every session. Clearing the local user first stops the
      // login page from seeing a stale session and redirecting away from it.
      await fetchMe();
      navigate('/login', {
        replace: true,
        state: { notice: 'Password reset. Sign in with the new password.' },
      });
    } catch (err) {
      setError(err.response?.data?.message || 'That code is invalid or has expired.');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const updateCode = (event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 8));

  return (
    <div className="auth-page">
      <div className="auth-box">
        <h1 className="auth-title">Recover your account</h1>

        {stage === 'start' && (
          <>
            <p className="auth-subtitle">
              Enter your handle and the recovery email you confirmed in Security &amp; auth. A
              backup address can only recover an account seven days after it was added.
            </p>

            <form onSubmit={start}>
              {error && <div className="form-error">{error}</div>}
              <div className="form-group">
                <label className="form-label" htmlFor="recovery-username">
                  Username
                </label>
                <input
                  id="recovery-username"
                  className="form-input"
                  type="text"
                  name="username"
                  autoComplete="username"
                  value={form.username}
                  onChange={update}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="recovery-email">
                  Recovery email
                </label>
                <input
                  id="recovery-email"
                  className="form-input"
                  type="email"
                  name="recoveryEmail"
                  autoComplete="email"
                  placeholder="backup@example.com"
                  value={form.recoveryEmail}
                  onChange={update}
                  required
                />
              </div>
              <button className="btn btn-primary btn-full" disabled={busy}>
                {busy ? 'Starting...' : 'Send a recovery code'}
              </button>
            </form>
          </>
        )}

        {stage === 'verify' && (
          <>
            <div className="notice" role="status">
              {notice}
            </div>

            <form onSubmit={verify}>
              {error && <div className="form-error">{error}</div>}
              <div className="form-group">
                <label className="form-label" htmlFor="recovery-code">
                  8-digit code
                </label>
                <input
                  id="recovery-code"
                  className="form-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={8}
                  placeholder="00000000"
                  value={code}
                  onChange={updateCode}
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '1.4rem',
                    letterSpacing: '0.45em',
                    textAlign: 'center',
                  }}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="recovery-password">
                  New password
                </label>
                <input
                  id="recovery-password"
                  className="form-input"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="recovery-confirm">
                  Confirm new password
                </label>
                <input
                  id="recovery-confirm"
                  className="form-input"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  required
                />
              </div>
              <button className="btn btn-primary btn-full" disabled={busy}>
                {busy ? 'Saving...' : 'Set the new password'}
              </button>
            </form>

            <button
              type="button"
              className="btn btn-ghost btn-full"
              onClick={() => {
                setStage('start');
                setError('');
                setNotice('');
              }}
            >
              Use different details
            </button>
          </>
        )}

        <p className="auth-footer">
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
};

export default AccountRecovery;
