import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';

const VerifyEmail = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const { user, fetchMe } = useAuth();
  const [status, setStatus] = useState(token ? 'checking' : 'error');
  const [message, setMessage] = useState(
    token ? '' : 'This verification link is missing its token. Request a new email.'
  );
  const [resending, setResending] = useState(false);
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
          err.response?.data?.message || 'This link is invalid or has expired. Request a new one.'
        );
      }
    })();
  }, [token, fetchMe]);

  const resend = async () => {
    setResending(true);
    setMessage('');
    try {
      await axiosInstance.post('/auth/verify-email/resend');
      setMessage('A fresh verification email is on its way.');
    } catch (err) {
      setMessage(err.response?.data?.message || 'Could not send that email right now.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-box">
        <h1 className="auth-title">
          {status === 'verified' ? 'Email confirmed' : 'Confirm your email'}
        </h1>

        {status === 'checking' && (
          <p className="auth-subtitle">Checking that link now…</p>
        )}

        {status === 'verified' && (
          <>
            <div className="notice notice-success" role="status">
              Your email is verified. You can now change your password from Security &amp; auth.
            </div>
            <p className="auth-footer">
              <Link to={user ? '/settings?tab=security' : '/login'}>
                {user ? 'Open security settings' : 'Sign in'}
              </Link>
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            {message && <div className="form-error">{message}</div>}
            {user && (
              <button
                type="button"
                className="btn btn-primary btn-full"
                onClick={resend}
                disabled={resending}
              >
                {resending ? 'Sending…' : 'Send a new verification email'}
              </button>
            )}
            <p className="auth-footer">
              {user ? (
                <Link to="/settings?tab=security">Back to security settings</Link>
              ) : (
                <Link to="/login">Sign in to request a new link</Link>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default VerifyEmail;
