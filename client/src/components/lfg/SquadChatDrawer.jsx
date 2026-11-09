import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axiosInstance from '../../api/axiosInstance';
import { getSocket } from '../../api/socket';
import { CloseIcon, SendIcon, ClockIcon, LockIcon } from '../common/icons';
import HashtagText from '../posts/HashtagText';

const TTL_DAYS = 15;

function remainingLabel(expiresAt, now) {
  if (!expiresAt) return '';
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days >= 1) return `${days}d ${hours}h left`;
  if (hours >= 1) return `${hours}h left`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m left`;
}

/**
 * Temporary squad chat (15 days, owner-refreshable).
 *
 * The drawer is a view over server state: expiry, membership and the refresh
 * right are all resolved by the API, so an expired chat cannot be kept alive by
 * leaving this panel open.
 */
const SquadChatDrawer = ({ chatId, squadTitle, onClose }) => {
  const [chat, setChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [ended, setEnded] = useState('');
  const [now, setNow] = useState(Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const bottomRef = useRef(null);
  const socketRef = useRef(null);

  const load = useCallback(async () => {
    if (!chatId) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await axiosInstance.get(`/squad-chats/${chatId}/messages?limit=50`);
      setChat(data.chat);
      setMessages(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      const message = err.response?.data?.message || 'Could not open this squad chat.';
      setError(message);
      if (err.response?.status === 403) setEnded(message);
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => { load(); }, [load]);

  // Countdown ticks without a re-render loop: one state update a minute.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!chatId) return undefined;
    const socket = getSocket();
    socketRef.current = socket;
    if (!socket) return undefined;

    const onJoined = (payload) => {
      if (payload?.chat) setChat(payload.chat);
    };
    const onMessage = (message) => {
      if (!message || String(message.chatId) !== String(chatId)) return;
      setMessages(prev => (prev.some(item => item._id === message._id) ? prev : [...prev, message]));
    };
    const onRefreshed = (payload) => {
      if (String(payload?.chatId) !== String(chatId)) return;
      setChat(prev => (prev ? { ...prev, expiresAt: payload.expiresAt, refreshCount: payload.refreshCount } : prev));
    };
    const onEnded = (payload) => {
      if (payload?.chatId && String(payload.chatId) !== String(chatId)) return;
      setEnded(payload?.reason || 'This squad chat is no longer open.');
    };

    socket.on('joined_squad_chat', onJoined);
    socket.on('squad_message', onMessage);
    socket.on('squad_chat_refreshed', onRefreshed);
    socket.on('squad_chat_expired', onEnded);
    socket.on('squad_chat_closed', onEnded);
    socket.on('squad_chat_evicted', () => setEnded('You are no longer part of this squad.'));

    socket.emit('join_squad_chat', { chatId });

    return () => {
      socket.off('joined_squad_chat', onJoined);
      socket.off('squad_message', onMessage);
      socket.off('squad_chat_refreshed', onRefreshed);
      socket.off('squad_chat_expired', onEnded);
      socket.off('squad_chat_closed', onEnded);
      socket.emit('leave_squad_chat', { chatId });
    };
  }, [chatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const send = async (event) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || sending || ended) return;

    setSending(true);
    setError('');
    try {
      const socket = socketRef.current;
      if (socket?.connected) {
        socket.emit('send_squad_message', { chatId, text });
      } else {
        const { data } = await axiosInstance.post(`/squad-chats/${chatId}/messages`, { text });
        setMessages(prev => [...prev, data.message]);
      }
      setDraft('');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not send that message.');
    } finally {
      setSending(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    setError('');
    try {
      const { data } = await axiosInstance.post(`/squad-chats/${chatId}/refresh`);
      setChat(data.chat);
      setEnded('');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not extend this chat.');
    } finally {
      setRefreshing(false);
    }
  };

  const label = useMemo(
    () => (chat ? remainingLabel(chat.expiresAt, now) : ''),
    [chat, now]
  );

  return (
    <>
      <div className="squad-scrim" onClick={onClose} role="presentation" />
      <aside className="squad-drawer" role="dialog" aria-modal="true" aria-label="Squad chat">
        <header className="squad-drawer-head">
          <div className="squad-drawer-title">
            <span className="squad-drawer-name">{squadTitle || 'Squad chat'}</span>
            <span className={`squad-expiry${label === 'expired' ? ' expired' : ''}`}>
              <ClockIcon size={12} /> {label || `expires in ${TTL_DAYS} days`}
            </span>
          </div>
          <div className="squad-drawer-actions">
            {chat?.canRefresh && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={refresh}
                disabled={refreshing}
                title="Extend this chat by 15 days"
              >
                {refreshing ? 'Extending…' : 'Extend 15d'}
              </button>
            )}
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close squad chat">
              <CloseIcon />
            </button>
          </div>
        </header>

        <div className="squad-drawer-body">
          {error && <div className="form-error">{error}</div>}

          {loading ? (
            <div className="spinner" />
          ) : ended ? (
            <div className="chat-locked">
              <LockIcon size={22} />
              <h3>Squad chat closed</h3>
              <p>{ended}</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="chat-empty">
              <p>No messages yet. Say hello to your squad.</p>
            </div>
          ) : (
            <ul className="squad-messages">
              {messages.map(message => (
                <li key={message._id} className="squad-message">
                  <span className="squad-message-avatar">
                    {String(message.author?.username || '?').slice(0, 1).toUpperCase()}
                  </span>
                  <div className="squad-message-body">
                    <div className="squad-message-head">
                      <span className="squad-message-author">@{message.author?.username}</span>
                      <span className="chat-timestamp">
                        {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="squad-message-text">
                      <HashtagText text={message.text} hashtags={false} />
                    </p>
                  </div>
                </li>
              ))}
              <li ref={bottomRef} aria-hidden="true" />
            </ul>
          )}
        </div>

        {!ended && !loading && (
          <form className="squad-composer" onSubmit={send}>
            <textarea
              className="form-textarea squad-composer-input"
              value={draft}
              maxLength={1000}
              rows={1}
              placeholder="Message your squad…"
              aria-label="Message your squad"
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send(e);
                }
              }}
            />
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={sending || !draft.trim()}
              aria-label="Send message"
            >
              <SendIcon size={14} />
            </button>
          </form>
        )}
      </aside>
    </>
  );
};

export default SquadChatDrawer;
