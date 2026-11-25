import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleChange = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (!token) {
      setError('This link is invalid or has expired. Request a new one.');
      return;
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (form.password !== form.confirm) {
      setError('Those passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await axiosInstance.post('/auth/reset-password', {
        token,
        password: form.password,
      });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not reset the password. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-box">
        <h1 className="auth-title">Choose a new password</h1>
        <p className="auth-subtitle">
          This link can be used once and expires 30 minutes after it was sent.
        </p>

        {done ? (
          <>
            <div className="notice notice-success" role="status">
              Your password has been changed. Sign in with the new password; every other session has
              been signed out.
            </div>
            <p className="auth-footer">
              <Link to="/login">Sign in</Link>
            </p>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && <div className="form-error">{error}</div>}
            <div className="form-group">
              <label className="form-label" htmlFor="reset-password">
                New password
              </label>
              <input
                id="reset-password"
                className="form-input"
                type="password"
                name="password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={form.password}
                onChange={handleChange}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="reset-confirm">
                Confirm password
              </label>
              <input
                id="reset-confirm"
                className="form-input"
                type="password"
                name="confirm"
                autoComplete="new-password"
                placeholder="Repeat the new password"
                value={form.confirm}
                onChange={handleChange}
                required
              />
            </div>
            <button className="btn btn-primary btn-full" disabled={loading || !token}>
              {loading ? 'Changing password…' : 'Change password'}
            </button>
            <p className="auth-footer">
              Need a new link? <Link to="/forgot-password">Request another</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
