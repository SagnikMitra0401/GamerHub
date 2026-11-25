import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';
import ProfilePanel from '../components/settings/ProfilePanel';
import FeedPanel from '../components/settings/FeedPanel';
import PrivacyPanel from '../components/settings/PrivacyPanel';
import NotificationPanel from '../components/settings/NotificationPanel';
import BusinessPanel from '../components/settings/BusinessPanel';
import SecurityPanel from '../components/settings/SecurityPanel';
import DangerPanel from '../components/settings/DangerPanel';
import { SettingsSkeleton } from '../components/common/Skeleton';
import {
  AlertIcon,
  BellIcon,
  BriefcaseIcon,
  CompassIcon,
  CloseIcon,
  LockIcon,
  PencilIcon,
  UsersIcon,
} from '../components/common/icons';

const TABS = [
  {
    key: 'profile',
    label: 'Profile & identity',
    hint: 'Handle, bio, passport',
    icon: PencilIcon,
  },
  {
    key: 'business',
    label: 'Business account',
    hint: 'Disclosure and verification',
    icon: BriefcaseIcon,
  },
  {
    key: 'feed',
    label: 'Feed algorithm',
    hint: 'Recommendations and reset',
    icon: CompassIcon,
  },
  {
    key: 'privacy',
    label: 'Privacy & safety',
    hint: 'Invites, blocks, export',
    icon: UsersIcon,
  },
  {
    key: 'notifications',
    label: 'Notifications',
    hint: 'Activity and squads',
    icon: BellIcon,
  },
  {
    key: 'security',
    label: 'Security & auth',
    hint: 'Google, sessions',
    icon: LockIcon,
  },
  {
    key: 'danger',
    label: 'Danger zone',
    hint: 'Freeze and deletion',
    icon: AlertIcon,
  },
];

const TAB_KEYS = new Set(TABS.map((tab) => tab.key));

const SettingsPage = () => {
  const { user, updateUser, fetchMe } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const requestedTab = searchParams.get('tab');
  const activeTab = TAB_KEYS.has(requestedTab) ? requestedTab : 'profile';

  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState(null);
  const railRef = useRef(null);

  const refresh = useCallback(async () => {
    const { data } = await axiosInstance.get('/account');
    setAccount(data);
    return data;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axiosInstance.get('/account');
        if (!cancelled) setAccount(data);
      } catch {
        if (!cancelled) setLoadError('Could not load your account settings.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const notify = useCallback((kind, message) => {
    setToast({ kind, message });
  }, []);

  const selectTab = (key) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', key);
    setSearchParams(next, { replace: true });
  };

  // Below the two-column breakpoint the rail is a horizontal strip, and the
  // selected tab can sit past its right edge with nothing highlighted in view.
  // Bring it back into the strip without moving the page. This also runs on
  // resize, since a desktop rail becomes the strip when the window narrows.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return undefined;
    const place = () => {
      const active = rail.querySelector('.settings-rail-btn.is-active');
      if (!active) return;
      if (rail.scrollWidth <= rail.clientWidth + 1) {
        rail.scrollLeft = 0;
        return;
      }
      // Measured from the rendered rects, so the padding and border of the
      // strip are accounted for and the first tab cannot clip on the left.
      const railRect = rail.getBoundingClientRect();
      const btnRect = active.getBoundingClientRect();
      const pad = 8;
      let next = rail.scrollLeft;
      if (btnRect.left < railRect.left + pad) next -= railRect.left + pad - btnRect.left;
      else if (btnRect.right > railRect.right - pad) next += btnRect.right - (railRect.right - pad);
      const max = rail.scrollWidth - rail.clientWidth;
      rail.scrollLeft = Math.min(Math.max(0, next), max);
    };
    place();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(place);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [activeTab, loading]);

  const panelProps = {
    account: account || {},
    user,
    updateUser,
    fetchMe,
    refresh,
    notify,
  };

  return (
    <main className="page settings-page">
      <div className="container settings-frame">
        <header className="settings-hero">
          <span className="settings-eyebrow">Account control</span>
          <h1 className="settings-title">Settings</h1>
          <p className="settings-subtitle">
            One place for your handle, how the feed finds posts for you, who can reach you, every
            signed-in session, and the irreversible switches.
          </p>
          <Link to="/welcome" className="btn btn-ghost btn-sm settings-tune-link">
            {user?.onboardingCompletedAt === null ? 'Finish setting up' : 'Tune my feed'}
          </Link>
        </header>

        {toast && (
          <div
            className={`notice ${toast.kind === 'error' ? 'notice-error' : 'notice-success'} settings-toast`}
            role="status"
          >
            <span>{toast.message}</span>
            <button
              type="button"
              className="settings-toast-close"
              aria-label="Dismiss message"
              onClick={() => setToast(null)}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        )}

        {loadError && !account && (
          <div className="notice notice-error">
            <span className="settings-inline-error">
              <AlertIcon size={14} /> {loadError}
            </span>
          </div>
        )}

        {loading && !account ? (
          <SettingsSkeleton />
        ) : !account ? null : (
          <div className="settings-shell">
            <nav className="settings-rail" aria-label="Settings sections" ref={railRef}>
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = tab.key === activeTab;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    className={`settings-rail-btn${isActive ? ' is-active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => selectTab(tab.key)}
                  >
                    <span className="settings-rail-icon">
                      <Icon size={17} />
                    </span>
                    <span className="settings-rail-text">
                      <strong>{tab.label}</strong>
                      <small>{tab.hint}</small>
                    </span>
                  </button>
                );
              })}
              <div className="settings-rail-foot">
                Signed in as <strong>@{user?.username}</strong>
              </div>
            </nav>

            <section className="settings-panel" aria-live="polite">
              {activeTab === 'profile' && <ProfilePanel {...panelProps} />}
              {activeTab === 'business' && <BusinessPanel {...panelProps} />}
              {activeTab === 'feed' && <FeedPanel {...panelProps} />}
              {activeTab === 'privacy' && <PrivacyPanel {...panelProps} />}
              {activeTab === 'notifications' && <NotificationPanel {...panelProps} />}
              {activeTab === 'security' && <SecurityPanel {...panelProps} />}
              {activeTab === 'danger' && <DangerPanel {...panelProps} />}
            </section>
          </div>
        )}
      </div>
    </main>
  );
};

export default SettingsPage;
