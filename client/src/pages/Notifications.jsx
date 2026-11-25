import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import { connectSocket } from '../api/socket';
import { useAuth } from '../context/AuthContext';
import { announceNotificationState, subscribeNotificationState } from '../utils/notificationEvents';
import { AlertIcon, BellIcon } from '../components/common/icons';
import SafeImage from '../components/common/SafeImage';

const PAGE_SIZE = 25;

const TYPE_META = {
  lfg_request: { label: 'Squad request' },
  lfg_accepted: { label: 'Squad' },
  gaming_bot: { label: 'Gaming bot' },
  social: { label: 'Update' },
  broadcast: { label: 'Channel post' },
};

const KIND_META = {
  comment: 'Comment',
  reply: 'Reply',
  follow: 'New follower',
  follow_request: 'Follow request',
  like: 'Like',
  like_milestone: 'Like milestone',
};

function metaFor(notification) {
  const kind = String(notification?.metadata?.kind || '').toLowerCase();
  if (KIND_META[kind]) return { label: KIND_META[kind] };
  return TYPE_META[notification?.type] || TYPE_META.social;
}

function timeAgo(value) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const Notifications = () => {
  const { token } = useAuth();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async ({ before = null } = {}) => {
    if (before) setLoadingMore(true);
    else setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (before) params.set('before', before);
      const { data } = await axiosInstance.get(`/notifications?${params.toString()}`);
      const next = Array.isArray(data.items) ? data.items : [];

      setItems((previous) => {
        if (!before) return next;
        const seen = new Set(previous.map((item) => item._id));
        return [...previous, ...next.filter((item) => !seen.has(item._id))];
      });
      setUnread(Math.max(0, Number(data.unreadCount) || 0));
      setCursor(data.nextCursor || null);
      setHasMore(Boolean(data.hasMore && data.nextCursor));
    } catch {
      setError('Could not load your notifications.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    axiosInstance.post('/notifications/opened', { surface: 'page' }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!token) return undefined;
    const socket = connectSocket(token);
    if (!socket) return undefined;

    const onNotification = (notification) => {
      if (!notification?._id) return;
      setItems((previous) =>
        previous.some((item) => item._id === notification._id)
          ? previous
          : [notification, ...previous],
      );
      setUnread((count) => count + 1);
    };

    socket.on('notification', onNotification);
    return () => {
      socket.off('notification', onNotification);
    };
  }, [token]);

  useEffect(
    () =>
      subscribeNotificationState((detail) => {
        if (detail.type === 'read-all') {
          setItems((previous) => previous.map((item) => ({ ...item, read: true })));
        } else if (detail.type === 'read' && detail.id) {
          setItems((previous) =>
            previous.map((item) => (item._id === detail.id ? { ...item, read: true } : item)),
          );
        }
        if (detail.unreadCount !== undefined) {
          setUnread(Math.max(0, Number(detail.unreadCount) || 0));
        }
      }),
    [],
  );

  const trackClick = (notification) => {
    axiosInstance
      .post(`/notifications/${notification._id}/clicked`, { surface: 'page' })
      .catch(() => {});
  };

  const markRead = async (notification) => {
    if (notification.read) return;
    setItems((previous) =>
      previous.map((item) => (item._id === notification._id ? { ...item, read: true } : item)),
    );
    setUnread((count) => Math.max(0, count - 1));

    try {
      const { data } = await axiosInstance.patch(`/notifications/${notification._id}/read`);
      announceNotificationState({
        type: 'read',
        id: notification._id,
        unreadCount: data?.unreadCount,
      });
    } catch {
      load();
    }
  };

  const markAllRead = async () => {
    setItems((previous) => previous.map((item) => ({ ...item, read: true })));
    setUnread(0);
    try {
      await axiosInstance.post('/notifications/read-all');
      announceNotificationState({ type: 'read-all', unreadCount: 0 });
    } catch {
      load();
    }
  };

  const firstReadAfterUnread = items.findIndex(
    (item, index) => item.read && items.slice(0, index).some((previous) => !previous.read),
  );

  return (
    <main className="page notif-page">
      <div className="container notif-page-container">
        <header className="notif-page-head">
          <div>
            <span className="notif-page-eyebrow">Activity</span>
            <h1 className="notif-page-title">
              <BellIcon size={24} /> Notifications
            </h1>
            <p className="notif-page-sub">
              Comments, follows, squad requests and gaming-bot picks, newest first.
              {unread > 0 ? ` ${unread} unread.` : ' You are all caught up.'}
            </p>
          </div>
          <div className="notif-page-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={markAllRead}
              disabled={unread === 0 || items.length === 0}
            >
              Mark all read
            </button>
            <Link to="/settings?tab=notifications" className="btn btn-ghost btn-sm">
              Preferences
            </Link>
          </div>
        </header>

        {error && (
          <div className="notice notice-error" role="alert">
            <span className="settings-inline-error">
              <AlertIcon size={14} /> {error}
            </span>
          </div>
        )}

        {loading ? (
          <div className="notif-page-empty" role="status">
            Loading your notifications…
          </div>
        ) : items.length === 0 ? (
          <div className="notif-page-empty">
            <BellIcon size={28} />
            <h2>Nothing here yet</h2>
            <p>When someone comments, follows you or asks to join a squad, it will show up here.</p>
            <Link to="/discover" className="btn btn-ghost btn-sm">
              Find people to play with
            </Link>
          </div>
        ) : (
          <>
            <div className="notif-page-card">
              <div className="notif-page-list">
                {items.map((notification, index) => {
                  const meta = metaFor(notification);
                  const isExternal = /^https?:\/\//i.test(notification.actionUrl || '');
                  const body = (
                    <>
                      <SafeImage
                        className="notif-thumb"
                        src={notification.mediaThumbnail}
                        alt=""
                        loading="lazy"
                        fallback={
                          <span className={`notif-dot ${notification.type}`} aria-hidden="true" />
                        }
                      />
                      <span className="notif-body">
                        <span className="notif-type">{meta.label}</span>
                        <span className="notif-title">{notification.title}</span>
                        {notification.message && (
                          <span className="notif-msg">{notification.message}</span>
                        )}
                        <span className="notif-meta">
                          {timeAgo(notification.createdAt)}
                          {!notification.read && <span className="notif-page-unread">Unread</span>}
                        </span>
                      </span>
                    </>
                  );

                  const row = notification.actionUrl ? (
                    isExternal ? (
                      <a
                        className="notif-row"
                        href={notification.actionUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        onClick={() => {
                          trackClick(notification);
                          markRead(notification);
                        }}
                      >
                        {body}
                      </a>
                    ) : (
                      <Link
                        className="notif-row"
                        to={notification.actionUrl}
                        onClick={() => {
                          trackClick(notification);
                          markRead(notification);
                        }}
                      >
                        {body}
                      </Link>
                    )
                  ) : (
                    <span
                      className="notif-row"
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        trackClick(notification);
                        markRead(notification);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          trackClick(notification);
                          markRead(notification);
                        }
                      }}
                    >
                      {body}
                    </span>
                  );

                  return (
                    <React.Fragment key={notification._id}>
                      {index === firstReadAfterUnread && (
                        <div className="notif-page-divider" aria-hidden="true">
                          <span>Earlier</span>
                        </div>
                      )}
                      <div className={`notif-item${notification.read ? '' : ' unread'}`}>{row}</div>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>

            <div className="notif-page-footer">
              {hasMore ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={loadingMore}
                  onClick={() => load({ before: cursor })}
                >
                  {loadingMore ? 'Loading…' : 'Load older'}
                </button>
              ) : (
                <span className="notif-page-end">That is the whole history.</span>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
};

export default Notifications;
