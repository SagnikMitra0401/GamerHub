import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';
import { safeRedirect } from '../utils/redirect';

/**
 * Two ways in: a legacy `?token=` link and the current 8-digit code.
 *
 * The code is typed here and compared on the server. It is never rendered from
 * a response, a query string or a context value, so nothing in the page, the
 * DOM or the console holds a working code while the account waits for one.
 */
const VerifyEmail = () => {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const token = searchParams.get('token') || '';
  const next = safeRedirect(location.search);
  const { user, fetchMe } = useAuth();

  const [status, setStatus] = useState(token ? 'checking' : 'idle');
  const [message, setMessage] = useState('');
  const [code, setCode] = useState('');
  const [attemptsLeft, setAttemptsLeft] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendNotice, setResendNotice] = useState('');
  const submitted = useRef(false);

  useEffect(() => {
    if (!token || submitted.current) return;
    submitted.current = true;

    // No cancellation flag: React StrictMode runs the effect twice in
    // development. The ref prevents a second token submission, and the first
    // request is still allowed to settle even if the effect cleanup runs.
    (async () => {
      try {
        await axiosInstance.post('/auth/verify-email', { token });
        setStatus('verified');
        await fetchMe();
      } catch (err) {
        setStatus('error');
        setMessage(
          err.response?.data?.message || 'This link is invalid or has expired. Request a new one.',
        );
      }
    })();
  }, [token, fetchMe]);

  const verified = status === 'verified' || (user && user.emailVerified === true);

  const submitCode = async (event) => {
    event.preventDefault();
    setMessage('');
    setAttemptsLeft(null);

    if (!/^\d{8}$/.test(code)) {
      setMessage('Enter the 8 digits from the email.');
      return;
    }

    setSubmitting(true);
    try {
      await axiosInstance.post('/auth/verify-email/code', { code });
      setStatus('verified');
      setCode('');
      await fetchMe();
    } catch (err) {
      setMessage(err.response?.data?.message || 'That code is invalid or has expired.');
      const remaining = err.response?.data?.attemptsRemaining;
      setAttemptsLeft(typeof remaining === 'number' ? remaining : null);
      setCode('');
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    setResending(true);
    setMessage('');
    setResendNotice('');
    try {
      await axiosInstance.post('/auth/verify-email/resend');
      setResendNotice('A new code is on its way. The previous code no longer works.');
      setCode('');
      setAttemptsLeft(null);
    } catch (err) {
      setMessage(err.response?.data?.message || 'Could not send that email right now.');
    } finally {
      setResending(false);
    }
  };

  const updateCode = (event) => {
    setCode(event.target.value.replace(/\D/g, '').slice(0, 8));
  };

  const continueTo = next !== '/' ? next : '/welcome';

  return (
    <div className="auth-page">
      <div className="auth-box">
        <h1 className="auth-title">{verified ? 'Email confirmed' : 'Confirm your email'}</h1>

        {status === 'checking' && <p className="auth-subtitle">Checking that link now.</p>}

        {verified && (
          <>
            <div className="notice notice-success" role="status">
              Your email is verified. Password changes and account recovery are unlocked.
            </div>
            <p className="auth-footer">
              {user ? <Link to={continueTo}>Continue</Link> : <Link to="/login">Sign in</Link>}
            </p>
          </>
        )}

        {!verified && !user && !token && (
          <>
            <p className="auth-subtitle">
              Sign in with the account you just created to enter the code from your email.
            </p>
            <p className="auth-footer">
              <Link to="/login">Sign in</Link>
            </p>
          </>
        )}

        {!verified && user && (
          <>
            <p className="auth-subtitle">
              We sent an 8-digit code to <strong>{user.email}</strong>. It expires after 10 minutes
              and it is only in that email, so it never appears in this page.
            </p>

            {status === 'error' && message && <div className="form-error">{message}</div>}

            <form onSubmit={submitCode}>
              <div className="form-group">
                <label className="form-label" htmlFor="verify-code">
                  8-digit code
                </label>
                <input
                  id="verify-code"
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

              {message && status !== 'error' && <div className="form-error">{message}</div>}
              {attemptsLeft !== null && attemptsLeft > 0 && (
                <p className="auth-subtitle">
                  {attemptsLeft === 1 ? 'One try left.' : `${attemptsLeft} tries left.`}
                </p>
              )}

              <button
                className="btn btn-primary btn-full"
                disabled={submitting || code.length !== 8}
              >
                {submitting ? 'Checking...' : 'Confirm email'}
              </button>
            </form>

            {resendNotice && <p className="auth-subtitle">{resendNotice}</p>}

            <button
              type="button"
              className="btn btn-ghost btn-full"
              onClick={resend}
              disabled={resending}
            >
              {resending ? 'Sending...' : 'Send a new code'}
            </button>

            <p className="auth-footer">
              <Link to="/settings?tab=security">Open security settings</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default VerifyEmail;
