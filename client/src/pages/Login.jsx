import React, { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import LoginForm from '../components/auth/LoginForm';
import GoogleSignInButton from '../components/auth/GoogleSignInButton';
import { useAuth } from '../context/AuthContext';
import { safeRedirect, withRedirect } from '../utils/redirect';

const Login = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirect = safeRedirect(location.search);

  useEffect(() => {
    if (loading || !user) return;
    // Verification is part of signing in: an unconfirmed account goes to the
    // code screen, and keeps its original destination in the query string.
    if (user.emailVerified === false) {
      navigate(withRedirect('/verify-email', location.search), { replace: true });
      return;
    }
    navigate(redirect, { replace: true });
  }, [user, loading, navigate, redirect, location.search]);

  return (
    <div className="auth-page">
      <div className="auth-box">
        <h1 className="auth-title">Welcome Back</h1>
        <p className="auth-subtitle">Sign in to continue to GamingHub</p>
        {location.state?.notice && (
          <div className="notice notice-success auth-notice" role="status">
            {location.state.notice}
          </div>
        )}
        <LoginForm />
        <GoogleSignInButton />
        <p className="auth-footer">
          New here? <Link to={withRedirect('/register', location.search)}>Create an account</Link>
        </p>
      </div>
    </div>
  );
};

export default Login;
