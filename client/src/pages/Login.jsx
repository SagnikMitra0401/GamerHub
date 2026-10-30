import React from 'react';
import { Link } from 'react-router-dom';
import LoginForm from '../components/auth/LoginForm';
import GoogleSignInButton from '../components/auth/GoogleSignInButton';

const Login = () => (
  <div className="auth-page">
    <div className="auth-box">
      <h1 className="auth-title">Welcome Back</h1>
      <p className="auth-subtitle">Sign in to continue to GamingHub</p>
      <LoginForm />
      <GoogleSignInButton />
      <p className="auth-footer">
        New here? <Link to="/register">Create an account</Link>
      </p>
    </div>
  </div>
);

export default Login;
