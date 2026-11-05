import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';
import ProfilePanel from '../components/settings/ProfilePanel';
import FeedPanel from '../components/settings/FeedPanel';
import PrivacyPanel from '../components/settings/PrivacyPanel';
import SecurityPanel from '../components/settings/SecurityPanel';
import DangerPanel from '../components/settings/DangerPanel';
import { SettingsSkeleton } from '../components/common/Skeleton';
import {
  AlertIcon, CompassIcon, CloseIcon, LockIcon, PencilIcon, UsersIcon
} from '../components/common/icons';

const TABS = [
  {
    key: 'profile',
    label: 'Profile & identity',
    hint: 'Handle, bio, passport',
    icon: PencilIcon
  },
  {
    key: 'feed',
    label: 'Feed algorithm',
    hint: 'Recommendations and reset',
    icon: CompassIcon
  },
  {
    key: 'privacy',
    label: 'Privacy & safety',
    hint: 'Invites, blocks, export',
    icon: UsersIcon
  },
  {
    key: 'security',
    label: 'Security & auth',
    hint: 'Google, sessions',
    icon: LockIcon
  },
  {
    key: 'danger',
    label: 'Danger zone',
    hint: 'Freeze and deletion',
    icon: AlertIcon
  }
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
    return () => { cancelled = true; };
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

  const panelProps = {
    account: account || {},
    user,
    updateUser,
    fetchMe,
    refresh,
    notify
  };

  return (
    <main className="page settings-page">
      <div className="container">
        <header className="settings-hero">
          <span className="settings-eyebrow">Account control</span>
          <h1 className="settings-title">Settings</h1>
          <p className="settings-subtitle">
            One place for your handle, how the feed finds posts for you, who can reach you,
            every signed-in session, and the irreversible switches.
          </p>
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
            <nav className="settings-rail" aria-label="Settings sections">
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
                    <span className="settings-rail-icon"><Icon size={17} /></span>
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
              {activeTab === 'feed' && <FeedPanel {...panelProps} />}
              {activeTab === 'privacy' && <PrivacyPanel {...panelProps} />}
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
