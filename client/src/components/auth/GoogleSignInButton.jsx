import React, { useEffect, useRef, useState } from 'react';
import axiosInstance from '../../api/axiosInstance';
import { useAuth } from '../../context/AuthContext';

const SCRIPT_ID = 'google-identity-services';

/**
 * Google Sign-In via Google Identity Services.
 *
 * The server decides whether the provider is configured: with no
 * GOOGLE_CLIENT_ID the component renders nothing at all instead of a button
 * that fails. The ID token is posted to /auth/google and verified server-side;
 * nothing about the profile is trusted from the browser.
 */
const GoogleSignInButton = ({ onError }) => {
  const { loginWithGoogle } = useAuth();
  const mountRef = useRef(null);
  const [config, setConfig] = useState(null);

  useEffect(() => {
    let cancelled = false;
    axiosInstance.get('/auth/providers')
      .then(({ data }) => {
        if (!cancelled) setConfig(data.google || { enabled: false });
      })
      .catch(() => {
        if (!cancelled) setConfig({ enabled: false });
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!config?.enabled || !config.clientId || !mountRef.current) return undefined;

    const mountWidget = () => {
      if (!window.google?.accounts?.id || !mountRef.current) return;
      window.google.accounts.id.initialize({
        client_id: config.clientId,
        callback: async (response) => {
          try {
            await loginWithGoogle(response.credential);
          } catch (err) {
            onError?.(err.response?.data?.message || 'Google sign-in failed.');
          }
        }
      });
      window.google.accounts.id.renderButton(mountRef.current, {
        theme: 'filled_black',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        width: 320
      });
    };

    if (document.getElementById(SCRIPT_ID)) {
      mountWidget();
      return undefined;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = mountWidget;
    document.head.appendChild(script);

    return () => {
      // The script and the widget are global; removing them would break the
      // other auth page, so only the local listener is dropped.
    };
  }, [config?.enabled, config?.clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!config?.enabled) return null;

  return (
    <div className="auth-divider-row">
      <span className="auth-divider-line" />
      <span className="auth-divider-label">or</span>
      <span className="auth-divider-line" />
      <div className="auth-google-slot" ref={mountRef} />
    </div>
  );
};

export default GoogleSignInButton;
