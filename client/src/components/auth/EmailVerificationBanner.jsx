import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import axiosInstance from '../../api/axiosInstance';
import { useAuth } from '../../context/AuthContext';
import { CloseIcon, MailIcon } from '../common/icons';

const HIDDEN_PREFIXES = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
];

const readDismissed = (userId) => {
  try {
    return window.sessionStorage.getItem(`gh-verify-dismissed:${userId}`) === '1';
  } catch {
    return false;
  }
};

const EmailVerificationBanner = () => {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(() => (user ? readDismissed(user._id) : false));
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');

  if (!user || user.emailVerified !== false) return null;
  if (HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;
  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(`gh-verify-dismissed:${user._id}`, '1');
    } catch {
      // A blocked sessionStorage must not break the banner.
    }
  };

  const resend = async () => {
    setSending(true);
    setNotice('');
    try {
      await axiosInstance.post('/auth/verify-email/resend');
      setNotice('Verification email sent. Check your inbox.');
    } catch (err) {
      setNotice(err.response?.data?.message || 'Could not send that email right now.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="verify-banner" role="status">
      <div className="container verify-banner-inner">
        <span className="verify-banner-icon">
          <MailIcon size={17} />
        </span>
        <p>
          <strong>Confirm your email.</strong>{' '}
          {notice || 'It keeps your account recoverable and unlocks password changes.'}
        </p>
        <div className="verify-banner-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={resend}
            disabled={sending}
          >
            {sending ? 'Sending…' : 'Resend'}
          </button>
          <Link to="/settings?tab=security" className="btn btn-ghost btn-sm">
            Settings
          </Link>
          <button
            type="button"
            className="icon-btn verify-banner-close"
            aria-label="Dismiss verification reminder"
            onClick={dismiss}
          >
            <CloseIcon size={15} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default EmailVerificationBanner;
