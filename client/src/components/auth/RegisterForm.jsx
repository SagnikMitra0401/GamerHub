import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const PLATFORMS = ['PC', 'PlayStation', 'Xbox', 'Switch'];

const RegisterForm = () => {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [platforms, setPlatforms] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = e => setForm({ ...form, [e.target.name]: e.target.value });

  const togglePlatform = p =>
    setPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(form.username, form.email, form.password, platforms);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="form-error">{error}</div>}
      <div className="form-group">
        <label className="form-label" htmlFor="reg-username">Username</label>
        <input
          id="reg-username"
          className="form-input"
          type="text"
          name="username"
          placeholder="GamerTag_123"
          value={form.username}
          onChange={handleChange}
          required
        />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="reg-email">Email</label>
        <input
          id="reg-email"
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
        <label className="form-label" htmlFor="reg-password">Password</label>
        <input
          id="reg-password"
          className="form-input"
          type="password"
          name="password"
          placeholder="At least 8 characters"
          value={form.password}
          onChange={handleChange}
          required
        />
      </div>
      <div className="form-group">
        <label className="form-label">Preferred Platforms</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.25rem' }}>
          {PLATFORMS.map(p => (
            <button
              key={p}
              type="button"
              onClick={() => togglePlatform(p)}
              className={`btn btn-sm ${platforms.includes(p) ? 'btn-primary' : 'btn-ghost'}`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <button id="register-submit" className="btn btn-primary btn-full" disabled={loading}>
        {loading ? 'Creating Account...' : 'Create Account'}
      </button>
    </form>
  );
};

export default RegisterForm;
