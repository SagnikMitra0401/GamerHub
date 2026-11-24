import React, { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import RegisterForm from '../components/auth/RegisterForm';
import GoogleSignInButton from '../components/auth/GoogleSignInButton';
import { useAuth } from '../context/AuthContext';
import { safeRedirect, withRedirect } from '../utils/redirect';

const Register = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirect = safeRedirect(location.search);

  useEffect(() => {
    if (loading || !user) return;
    // A new account proves the address before it meets the feed. This effect is
    // the only post-auth navigation, so the code screen cannot be raced by it.
    if (user.emailVerified === false) {
      navigate(withRedirect('/verify-email', location.search), { replace: true });
      return;
    }
    navigate(redirect, { replace: true });
  }, [user, loading, navigate, redirect, location.search]);

  return (
    <div className="auth-page">
      <div className="auth-box">
        <h1 className="auth-title">Join the Hub</h1>
        <p className="auth-subtitle">Create your gaming profile and start posting</p>
        <RegisterForm />
        <GoogleSignInButton />
        <p className="auth-footer">
          Already a member? <Link to={withRedirect('/login', location.search)}>Sign in</Link>
        </p>
      </div>
    </div>
  );
};

export default Register;
