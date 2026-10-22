import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import axiosInstance from '../../api/axiosInstance';
import { connectSocket } from '../../api/socket';
import { useAuth } from '../../context/AuthContext';

const TYPE_META = {
  lfg_request:  { icon: '🎯', label: 'Squad request' },
  lfg_accepted: { icon: '✅', label: 'Squad' },
  gaming_bot:   { icon: '🤖', label: 'Gaming bot' },
  social:       { icon: '🔔', label: 'Update' }
};

function timeAgo(value) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const NotificationBell = () => {
  const { user, token } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const wrapRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await axiosInstance.get('/notifications?limit=20');
      setItems(Array.isArray(data.items) ? data.items : []);
      setUnread(Number(data.unreadCount) || 0);
    } catch {
      setError('Could not load notifications.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return undefined;

    load();

    // The socket is shared app-wide; attaching here only listens.
    const socket = connectSocket(token);
    const onNotification = (notification) => {
      if (!notification?._id) return;
      setItems(prev => {
        if (prev.some(n => n._id === notification._id)) return prev;
        return [notification, ...prev].slice(0, 20);
      });
      setUnread(count => count + 1);
    };

    socket.on('notification', onNotification);
    return () => { socket.off('notification', onNotification); };
  }, [user?._id, token, load]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!user) return null;

  const markRead = async (notification) => {
    if (notification.read) return;
    setItems(prev => prev.map(n => (n._id === notification._id ? { ...n, read: true } : n)));
    setUnread(count => Math.max(0, count - 1));
    try {
      await axiosInstance.patch(`/notifications/${notification._id}/read`);
    } catch {
      // Optimistic UI is fine; the next load reconciles.
    }
  };

  const markAll = async () => {
    setItems(prev => prev.map(n => ({ ...n, read: true })));
    setUnread(0);
    try {
      await axiosInstance.post('/notifications/read-all');
    } catch {
      load();
    }
  };

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        type="button"
        className="notif-btn"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        🔔
        {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <strong>Notifications</strong>
            <button type="button" className="notif-link" onClick={markAll} disabled={!unread}>
              Mark all read
            </button>
          </div>

          {loading && items.length === 0 && <div className="notif-empty">Loading…</div>}
          {error && <div className="notif-empty">{error}</div>}
          {!loading && !error && items.length === 0 && (
            <div className="notif-empty">Nothing yet. Squad requests and gaming-bot pings land here.</div>
          )}

          <div className="notif-list">
            {items.map((notification) => {
              const meta = TYPE_META[notification.type] || TYPE_META.social;
              const isExternal = /^https?:\/\//i.test(notification.actionUrl || '');
              const body = (
                <>
                  {notification.mediaThumbnail ? (
                    <img className="notif-thumb" src={notification.mediaThumbnail} alt="" loading="lazy" />
                  ) : (
                    <span className="notif-icon" aria-hidden="true">{meta.icon}</span>
                  )}
                  <span className="notif-body">
                    <span className="notif-type">{meta.label}</span>
                    <span className="notif-title">{notification.title}</span>
                    {notification.message && <span className="notif-msg">{notification.message}</span>}
                    <span className="notif-meta">{timeAgo(notification.createdAt)}</span>
                  </span>
                </>
              );

              return (
                <div
                  key={notification._id}
                  className={`notif-item${notification.read ? '' : ' unread'}`}
                  onClick={() => markRead(notification)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') markRead(notification); }}
                >
                  {notification.actionUrl ? (
                    isExternal ? (
                      <a className="notif-row" href={notification.actionUrl} target="_blank" rel="noreferrer noopener">
                        {body}
                      </a>
                    ) : (
                      <Link className="notif-row" to={notification.actionUrl} onClick={() => setOpen(false)}>
                        {body}
                      </Link>
                    )
                  ) : (
                    <span className="notif-row">{body}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
