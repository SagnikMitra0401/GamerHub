import React, { useEffect, useRef, useState, useCallback } from 'react';
import axiosInstance from '../../api/axiosInstance';
import { useAuth } from '../../context/AuthContext';

const SCRIPT_ID = 'google-identity-services';
const SNAP_THRESHOLD = 0.88; // fraction of track where release triggers sign-in

/* ── Inline Google G multicolour SVG ──────────────────────────────────── */
const GoogleGIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 48 48"
    width="22"
    height="22"
    aria-hidden="true"
    focusable="false"
  >
    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
    <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
    <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
  </svg>
);

/* ── Checkmark SVG ─────────────────────────────────────────────────────── */
const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

/* ── Mini spinner ──────────────────────────────────────────────────────── */
const Spinner = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" className="gslider-spinner" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" />
    <path fill="none" stroke="#e2e8f0" strokeWidth="2.5" strokeLinecap="round" d="M12 3a9 9 0 0 1 9 9" />
  </svg>
);

/**
 * Slide-to-unlock Google Sign-In widget.
 *
 * Uses google.accounts.oauth2.initTokenClient (OAuth2 implicit flow) which
 * can be triggered programmatically — unlike the GIS renderButton iframe which
 * cannot. On a completed swipe, requestAccessToken() is called; the resulting
 * access_token is exchanged for a session via POST /auth/google { accessToken }.
 */
const GoogleSignInButton = ({ onError }) => {
  const { loginWithGoogle } = useAuth();

  /* ── Provider config ───────────────────────────────────────────────── */
  const [config, setConfig] = useState(null);

  useEffect(() => {
    let cancelled = false;
    axiosInstance.get('/auth/providers')
      .then(({ data }) => { if (!cancelled) setConfig(data.google || { enabled: false }); })
      .catch(() => { if (!cancelled) setConfig({ enabled: false }); });
    return () => { cancelled = true; };
  }, []);

  /* ── Drag state ────────────────────────────────────────────────────── */
  const trackRef  = useRef(null);
  const thumbRef  = useRef(null);
  const stateRef  = useRef({
    dragging: false,
    startX: 0,
    thumbX: 0,
    trackW: 0,
    thumbW: 0,
    maxX: 0,
  });

  const [progress, setProgress]   = useState(0);   // 0–1
  const [uiState, setUiState]     = useState('idle'); // idle | loading | success | error

  /* ── GIS token client (initialised once config is ready) ───────────── */
  const tokenClientRef = useRef(null);

  const handleToken = useCallback(async (tokenResponse) => {
    if (tokenResponse.error) {
      setUiState('error');
      snapBack();
      onError?.('Google sign-in was cancelled or failed.');
      setTimeout(() => setUiState('idle'), 1800);
      return;
    }
    setUiState('loading');
    try {
      await loginWithGoogle(null, tokenResponse.access_token);
      setUiState('success');
    } catch (err) {
      setUiState('error');
      snapBack();
      onError?.(err.response?.data?.message || 'Google sign-in failed.');
      setTimeout(() => setUiState('idle'), 1800);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginWithGoogle, onError]);

  useEffect(() => {
    if (!config?.enabled || !config.clientId) return;

    const init = () => {
      if (!window.google?.accounts?.oauth2) return;
      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: config.clientId,
        scope: 'openid email profile',
        callback: handleToken,
      });
    };

    if (document.getElementById(SCRIPT_ID)) {
      // Script already present — may or may not be loaded yet
      if (window.google?.accounts?.oauth2) { init(); }
      else {
        const existing = document.getElementById(SCRIPT_ID);
        const prev = existing.onload;
        existing.onload = (...args) => { prev?.(...args); init(); };
      }
      return;
    }

    const script = document.createElement('script');
    script.id    = SCRIPT_ID;
    script.src   = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = init;
    document.head.appendChild(script);
  }, [config?.enabled, config?.clientId, handleToken]);

  /* ── Snap-back helper ──────────────────────────────────────────────── */
  const snapBack = useCallback(() => {
    const thumb = thumbRef.current;
    if (thumb) {
      thumb.style.transition = 'left 0.38s cubic-bezier(0.34,1.56,0.64,1)';
      thumb.style.left = '3px';
    }
    setProgress(0);
  }, []);

  /* ── Pointer event handlers ────────────────────────────────────────── */
  const onPointerDown = useCallback((e) => {
    if (uiState !== 'idle') return;
    e.preventDefault();
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!track || !thumb) return;

    thumb.style.transition = 'none';
    thumb.setPointerCapture(e.pointerId);

    const trackRect = track.getBoundingClientRect();
    const thumbRect = thumb.getBoundingClientRect();
    const trackW    = trackRect.width;
    const thumbW    = thumbRect.width;
    const maxX      = trackW - thumbW - 3;

    stateRef.current = {
      dragging: true,
      startX: e.clientX - thumbRect.left + trackRect.left,
      thumbX: 0,
      trackW,
      thumbW,
      maxX,
    };
  }, [uiState]);

  const onPointerMove = useCallback((e) => {
    const s = stateRef.current;
    if (!s.dragging) return;
    e.preventDefault();

    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!track || !thumb) return;

    const trackRect = track.getBoundingClientRect();
    const rawX      = e.clientX - trackRect.left - s.thumbW / 2;
    const clampedX  = Math.max(3, Math.min(rawX, s.maxX));
    const frac      = (clampedX - 3) / (s.maxX - 3 || 1);

    thumb.style.left = `${clampedX}px`;
    setProgress(frac);

    // CSS variable for the shimmer fill
    track.style.setProperty('--slider-progress', frac);
  }, []);

  const onPointerUp = useCallback((e) => {
    const s = stateRef.current;
    if (!s.dragging) return;
    s.dragging = false;
    e.preventDefault();

    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!track || !thumb) return;

    const trackRect = track.getBoundingClientRect();
    const thumbRect = thumb.getBoundingClientRect();
    const frac      = (thumbRect.left - trackRect.left - 3) / (s.maxX - 3 || 1);

    if (frac >= SNAP_THRESHOLD) {
      // Slide complete — complete position, then trigger
      thumb.style.transition = 'left 0.18s ease';
      thumb.style.left = `${s.maxX}px`;
      setProgress(1);
      setUiState('loading');
      setTimeout(() => {
        if (tokenClientRef.current) {
          tokenClientRef.current.requestAccessToken();
        } else {
          setUiState('error');
          onError?.('Google Sign-In is not ready yet. Please try again.');
          snapBack();
          setTimeout(() => setUiState('idle'), 1800);
        }
      }, 160);
    } else {
      snapBack();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapBack, onError]);

  /* ── Nothing to render if not configured ──────────────────────────── */
  if (config === null) return null;  // still loading provider config
  if (!config.enabled) return null;

  /* ── Label text ────────────────────────────────────────────────────── */
  const labelMap = {
    idle:    'Slide to continue with Google',
    loading: 'Connecting…',
    success: 'Signed in!',
    error:   'Try again',
  };

  return (
    <div className="gslider-wrap">
      {/* Divider */}
      <div className="gslider-divider">
        <span className="gslider-divider-line" />
        <span className="gslider-divider-text">or</span>
        <span className="gslider-divider-line" />
      </div>

      {/* Track */}
      <div
        className={`gslider-track gslider-track--${uiState}`}
        ref={trackRef}
        style={{ '--slider-progress': progress }}
        aria-label="Slide to sign in with Google"
        role="button"
        tabIndex={0}
      >
        {/* Progress fill */}
        <div className="gslider-fill" style={{ width: `calc(${progress * 100}% + 22px)` }} />

        {/* Label (fades as thumb moves right) */}
        <span
          className="gslider-label"
          style={{ opacity: Math.max(0, 1 - progress * 2.2) }}
        >
          {labelMap[uiState]}
        </span>

        {/* Thumb */}
        <div
          className={`gslider-thumb gslider-thumb--${uiState}`}
          ref={thumbRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ left: '3px', touchAction: 'none' }}
          aria-hidden="true"
        >
          {uiState === 'loading' && <Spinner />}
          {uiState === 'success' && <CheckIcon />}
          {uiState === 'error'   && <span className="gslider-thumb-err">!</span>}
          {uiState === 'idle'    && <GoogleGIcon />}
        </div>
      </div>
    </div>
  );
};

export default GoogleSignInButton;
