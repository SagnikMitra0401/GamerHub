import React, { useCallback, useEffect, useRef, useState } from 'react';
import axiosInstance from '../../api/axiosInstance';
import { AlertIcon, CheckIcon } from '../common/icons';

const SCRIPT_ID = 'google-identity-services';

/**
 * Link a Google identity to the current account.
 *
 * This is deliberately the standard GIS button, not the login slider: linking
 * is a settings action that should look and behave like the provider's own
 * control. The credential is verified server-side and the Google email must
 * match the account email, so a click cannot silently attach somebody else's
 * identity.
 */
const GoogleLinkButton = ({ onLinked, onError }) => {
  const slotRef = useRef(null);
  const callbackRef = useRef(onLinked);
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | linked
  const [error, setError] = useState('');

  useEffect(() => { callbackRef.current = onLinked; }, [onLinked]);

  useEffect(() => {
    let cancelled = false;
    axiosInstance.get('/auth/providers')
      .then(({ data }) => { if (!cancelled) setConfig(data.google || { enabled: false }); })
      .catch(() => { if (!cancelled) setConfig({ enabled: false }); });
    return () => { cancelled = true; };
  }, []);

  const handleCredential = useCallback(async (response) => {
    if (!response?.credential) return;
    setStatus('loading');
    setError('');
    try {
      const { data } = await axiosInstance.post('/auth/link-google', {
        credential: response.credential
      });
      setStatus('linked');
      callbackRef.current?.(data.providers || []);
    } catch (err) {
      setStatus('idle');
      const message = err.response?.data?.message || 'Could not link that Google account.';
      setError(message);
      onError?.(message);
    }
  }, [onError]);

  useEffect(() => {
    if (!config?.enabled || !config.clientId) return undefined;
    let disposed = false;

    const render = () => {
      if (disposed || !slotRef.current || !window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: config.clientId,
        callback: handleCredential,
        auto_select: false,
        cancel_on_tap_outside: true
      });
      slotRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(slotRef.current, {
        type: 'standard',
        theme: 'filled_black',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        logo_alignment: 'left',
        width: 280
      });
    };

    if (document.getElementById(SCRIPT_ID)) {
      if (window.google?.accounts?.id) render();
      else {
        const existing = document.getElementById(SCRIPT_ID);
        const previous = existing.onload;
        existing.onload = (...args) => {
          previous?.(...args);
          render();
        };
      }
      return () => { disposed = true; };
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = render;
    script.onerror = () => setError('Google Sign-In could not be loaded.');
    document.head.appendChild(script);

    return () => { disposed = true; };
  }, [config?.enabled, config?.clientId, handleCredential]);

  if (config === null) return null;
  if (!config.enabled) {
    return (
      <p className="settings-help">
        Google sign-in is not configured on this server.
      </p>
    );
  }

  if (status === 'linked') {
    return (
      <span className="settings-chip is-good">
        <CheckIcon size={14} /> Google connected
      </span>
    );
  }

  return (
    <div className="google-link-wrap">
      <div className="google-link-slot" ref={slotRef} />
      {status === 'loading' && <span className="settings-help">Verifying with Google…</span>}
      {error && (
        <span className="settings-inline-error">
          <AlertIcon size={13} /> {error}
        </span>
      )}
    </div>
  );
};

export default GoogleLinkButton;
