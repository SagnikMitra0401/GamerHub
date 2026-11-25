import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await axiosInstance.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not send the reset email. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-box">
        <h1 className="auth-title">Reset your password</h1>
        <p className="auth-subtitle">
          Enter the email on your account and we will send a one-time reset link.
        </p>

        {sent ? (
          <>
            <div className="notice notice-success" role="status">
              If an account exists for that email, a reset link is on its way. The link expires in
              30 minutes.
            </div>
            <p className="auth-footer">
              <Link to="/login">Back to sign in</Link>
            </p>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && <div className="form-error">{error}</div>}
            <div className="form-group">
              <label className="form-label" htmlFor="forgot-email">
                Email
              </label>
              <input
                id="forgot-email"
                className="form-input"
                type="email"
                name="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <button className="btn btn-primary btn-full" disabled={loading}>
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
            <p className="auth-footer">
              Remembered it? <Link to="/login">Sign in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
};

export default ForgotPassword;
