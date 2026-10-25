import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Link } from 'react-router-dom';
import axiosInstance from '../../api/axiosInstance';
import { connectSocket } from '../../api/socket';
import { useAuth } from '../../context/AuthContext';
import { CloseIcon } from './icons';

const TYPE_META = {
  lfg_request:  { label: 'Squad request' },
  lfg_accepted: { label: 'Squad' },
  gaming_bot:   { label: 'Gaming bot' },
  social:       { label: 'Update' }
};

/** Below this width the dropdown becomes a centred sheet (no edge clipping). */
const SHEET_QUERY = '(max-width: 640px)';

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
  const [sheet, setSheet] = useState(false);
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
      // The sheet is portalled out of this wrapper, so only treat outside
      // clicks as dismissal for the desktop dropdown.
      if (sheet) return;
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, sheet]);

  if (!user) return null;

  const toggle = () => {
    if (!open) setSheet(window.matchMedia(SHEET_QUERY).matches);
    setOpen(value => !value);
  };

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

  const panel = (
    <>
      <div className="notif-head">
        <strong>Notifications</strong>
        <div className="notif-head-actions">
          <button type="button" className="notif-link" onClick={markAll} disabled={!unread}>
            Mark all read
          </button>
          {sheet && (
            <button type="button" className="icon-btn notif-sheet-close" aria-label="Close notifications" onClick={() => setOpen(false)}>
              <CloseIcon size={17} />
            </button>
          )}
        </div>
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
                <span className={`notif-dot ${notification.type}`} aria-hidden="true" />
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
    </>
  );

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        type="button"
        className="notif-btn"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        aria-expanded={open}
        onClick={toggle}
      >
        <svg
          className="notif-glyph"
          viewBox="0 0 24 24"
          width="19"
          height="19"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M18 8a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
          <path d="M10.3 20a2 2 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (sheet
        ? ReactDOM.createPortal(
            <div className="notif-sheet-layer" role="presentation">
              <button
                type="button"
                className="notif-sheet-scrim"
                aria-label="Close notifications"
                tabIndex={-1}
                onClick={() => setOpen(false)}
              />
              <div className="notif-sheet" role="dialog" aria-modal="true" aria-label="Notifications">
                {panel}
              </div>
            </div>,
            document.body
          )
        : (
          <div className="notif-panel" role="dialog" aria-label="Notifications">
            {panel}
          </div>
        ))}
    </div>
  );
};

export default NotificationBell;
