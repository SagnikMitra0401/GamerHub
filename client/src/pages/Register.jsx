import React, { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import RegisterForm from '../components/auth/RegisterForm';
import GoogleSignInButton from '../components/auth/GoogleSignInButton';
import { useAuth } from '../context/AuthContext';

const Register = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      navigate('/', { replace: true });
    }
  }, [user, loading, navigate]);

  return (
    <div className="auth-page">
      <div className="auth-box">
        <h1 className="auth-title">Join the Hub</h1>
        <p className="auth-subtitle">Create your gaming profile and start posting</p>
        <RegisterForm />
        <GoogleSignInButton />
        <p className="auth-footer">
          Already a member? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
};

export default Register;
