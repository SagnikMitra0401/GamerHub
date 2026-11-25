import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Link } from 'react-router-dom';

const LoginForm = () => {
  const { login } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // The Login page routes the session once it exists: unconfirmed accounts
      // go to the code screen, everyone else to their original destination.
      await login(form.email, form.password);
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="form-error">{error}</div>}
      <div className="form-group">
        <label className="form-label" htmlFor="login-email">
          Email
        </label>
        <input
          id="login-email"
          className="form-input"
          type="email"
          name="email"
          placeholder="you@example.com"
          value={form.email}
          onChange={handleChange}
          required
        />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="login-password">
          Password
        </label>
        <input
          id="login-password"
          className="form-input"
          type="password"
          name="password"
          placeholder="••••••••"
          value={form.password}
          onChange={handleChange}
          required
        />
      </div>
      <div className="auth-inline-link">
        <Link to="/forgot-password">Forgot password?</Link>
        <Link to="/account-recovery">Use a recovery email</Link>
      </div>
      <button id="login-submit" className="btn btn-primary btn-full" disabled={loading}>
        {loading ? 'Signing in...' : 'Sign In'}
      </button>
    </form>
  );
};

export default LoginForm;
