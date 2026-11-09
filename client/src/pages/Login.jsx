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
    if (!loading && user) {
      navigate(redirect, { replace: true });
    }
  }, [user, loading, navigate, redirect]);

  return (
    <div className="auth-page">
      <div className="auth-box">
        <h1 className="auth-title">Welcome Back</h1>
        <p className="auth-subtitle">Sign in to continue to GamingHub</p>
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
