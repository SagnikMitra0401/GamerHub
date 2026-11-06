import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';
import { connectSocket } from '../api/socket';
import DmThread from '../components/messages/DmThread';
import { AlertIcon, MailIcon } from '../components/common/icons';

const FOLDERS = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'requests', label: 'Requests' },
  { key: 'sent', label: 'Sent' },
  { key: 'archived', label: 'Archived' }
];

const EMPTY_COPY = {
  inbox: {
    title: 'No conversations yet',
    body: 'When you and another player both agree to talk, the thread lives here. Open a profile to start with a request.'
  },
  requests: {
    title: 'No pending requests',
    body: 'First messages from people outside your trusted circle wait here. Nothing is delivered until you accept.'
  },
  sent: {
    title: 'No sent requests',
    body: 'Requests you start appear here while you wait. They expire after 14 days, and you can only send one to a player every 30 days.'
  },
  archived: {
    title: 'Nothing archived',
    body: 'Archive a conversation to clear it out of your inbox without deleting its history.'
  }
};

function timeAgo(value) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const MessagesPage = () => {
  const { user, token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const folder = searchParams.get('folder') || 'inbox';
  const activeId = searchParams.get('thread') || '';

  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ requests: 0, unread: 0, inbox: 0 });
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [thread, setThread] = useState(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState('');
  const [threadNonce, setThreadNonce] = useState(0);
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState('');

  const selectThread = useCallback((id) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('thread', id);
    else next.delete('thread');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const setFolder = (key) => {
    const next = new URLSearchParams(searchParams);
    next.set('folder', key);
    next.delete('thread');
    setSearchParams(next, { replace: true });
    setThread(null);
    setActionError('');
  };

  const refreshList = useCallback(async (showSpinner = false) => {
    if (showSpinner) setListLoading(true);
    try {
      const { data } = await axiosInstance.get(`/messages/conversations?folder=${encodeURIComponent(folder)}`);
      setItems(Array.isArray(data.items) ? data.items : []);
      setCounts({
        requests: Number(data?.counts?.requests) || 0,
        unread: Number(data?.counts?.unread) || 0,
        inbox: Number(data?.counts?.inbox) || 0
      });
      setListError('');
    } catch (err) {
      setListError(err.response?.data?.message || 'Could not load your inbox.');
    } finally {
      if (showSpinner) setListLoading(false);
    }
  }, [folder]);

  useEffect(() => {
    refreshList(true);
  }, [refreshList]);

  // Pick the first row on desktop once the list lands. A deep link (?thread=…)
  // always wins, even when that thread is not in the current folder.
  useEffect(() => {
    if (activeId || listLoading || items.length === 0) return;
    const next = new URLSearchParams(searchParams);
    next.set('thread', items[0]._id);
    setSearchParams(next, { replace: true });
  }, [activeId, listLoading, items, searchParams, setSearchParams]);

  useEffect(() => {
    if (!activeId) {
      setThread(null);
      setThreadError('');
      return undefined;
    }

    let cancelled = false;
    setThreadLoading(true);
    setThreadError('');

    axiosInstance.get(`/messages/conversations/${activeId}`)
      .then(({ data }) => {
        if (cancelled) return;
        setThread(data);
        if (data.conversation.state === 'active') {
          axiosInstance.post(`/messages/conversations/${activeId}/read`).catch(() => {});
          setItems((previous) => previous.map((item) => (
            item._id === activeId ? { ...item, unread: 0 } : item
          )));
        }
      })
      .catch((err) => {
        if (!cancelled) setThreadError(err.response?.data?.message || 'Could not open that conversation.');
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeId, threadNonce]);

  useEffect(() => {
    if (!user || !activeId) return undefined;
    const socket = connectSocket(token);

    const join = () => socket.emit('join_conversation', { conversationId: activeId });
    join();
    socket.on('connect', join);

    const onMessage = (payload) => {
      const conversationId = String(payload?.conversation?._id || '');
      if (conversationId === activeId) {
        setThread((previous) => {
          if (!previous) return previous;
          if (previous.messages.some((message) => message._id === payload.message?._id)) return previous;
          // The broadcast carries the *sender's* view of the conversation
          // (counterpart, isRecipient, canReply all point the other way). Only
          // the preview/timestamp are viewer-neutral; keep the local identity
          // fields and append the message.
          return {
            conversation: {
              ...previous.conversation,
              lastMessageAt: payload.conversation?.lastMessageAt || payload.message?.createdAt || previous.conversation.lastMessageAt,
              lastMessagePreview: payload.conversation?.lastMessagePreview ?? previous.conversation.lastMessagePreview,
              unread: 0
            },
            messages: payload.message ? [...previous.messages, payload.message] : previous.messages
          };
        });
        axiosInstance.post(`/messages/conversations/${activeId}/read`).catch(() => {});
      }
      refreshList();
    };

    const onAccepted = (payload) => {
      if (String(payload?.conversationId) === activeId) setThreadNonce((value) => value + 1);
      refreshList();
    };

    const onDeclined = (payload) => {
      if (String(payload?.conversationId) === activeId) {
        setThread((previous) => (previous
          ? { ...previous, conversation: { ...previous.conversation, state: 'declined', request: null } }
          : previous));
      }
      refreshList();
    };

    const onRead = () => refreshList();

    socket.on('dm_message', onMessage);
    socket.on('dm_accepted', onAccepted);
    socket.on('dm_declined', onDeclined);
    socket.on('dm_read', onRead);

    return () => {
      socket.off('connect', join);
      socket.off('dm_message', onMessage);
      socket.off('dm_accepted', onAccepted);
      socket.off('dm_declined', onDeclined);
      socket.off('dm_read', onRead);
      socket.emit('leave_conversation', { conversationId: activeId });
    };
  }, [user?._id, token, activeId, refreshList]);

  const runAction = async (name, action) => {
    setBusy(name);
    setActionError('');
    try {
      return await action();
    } catch (err) {
      setActionError(err.response?.data?.message || 'That action could not be completed.');
      return null;
    } finally {
      setBusy(null);
    }
  };

  const accept = () => runAction('accept', async () => {
    await axiosInstance.post(`/messages/conversations/${activeId}/accept`);
    setThreadNonce((value) => value + 1);
    await refreshList();
  });

  const decline = () => runAction('decline', async () => {
    await axiosInstance.delete(`/messages/conversations/${activeId}/request`);
    setThread(null);
    selectThread(null);
    await refreshList();
  });

  const send = (text) => runAction('send', async () => {
    const { data } = await axiosInstance.post(`/messages/conversations/${activeId}/messages`, { text });
    setThread((previous) => {
      if (!previous) return previous;
      if (previous.messages.some((message) => message._id === data.message?._id)) return previous;
      return {
        conversation: { ...previous.conversation, ...data.conversation },
        messages: data.message ? [...previous.messages, data.message] : previous.messages
      };
    });
    await refreshList();
    return true;
  });

  const archive = () => runAction('archive', async () => {
    await axiosInstance.post(`/messages/conversations/${activeId}/archive`);
    setThread(null);
    selectThread(null);
    await refreshList();
  });

  const mute = (muted) => runAction('mute', async () => {
    const { data } = await axiosInstance.patch(`/messages/conversations/${activeId}/mute`, { muted });
    setThread((previous) => (previous
      ? { ...previous, conversation: { ...previous.conversation, ...data.conversation } }
      : previous));
    await refreshList();
  });

  const report = ({ reason, note, block }) => runAction('report', async () => {
    await axiosInstance.post(`/messages/conversations/${activeId}/report`, { reason, note, block });
    if (block) {
      setThread(null);
      selectThread(null);
    }
    await refreshList();
    return true;
  });

  const empty = EMPTY_COPY[folder] || EMPTY_COPY.inbox;

  return (
    <main className="page messages-page">
      <div className="container dm-page-wrap">
        <header className="dm-hero">
          <span className="dm-eyebrow">Private channels</span>
          <h1>Messages</h1>
          <p>
            First contact is a request. Only people you accept can reply, and nobody sees read
            receipts until a thread is open.
          </p>
        </header>

        <div className={`dm-shell${activeId ? ' thread-open' : ''}`}>
          <aside className="dm-rail" aria-label="Conversations">
            <div className="dm-rail-head">
              <div>
                <strong>Inbox</strong>
                <span>{counts.unread > 0 ? `${counts.unread} unread` : 'You are caught up'}</span>
              </div>
              <span className="dm-rail-mark" aria-hidden="true"><MailIcon size={16} /></span>
            </div>

            <div className="dm-tabs" role="tablist" aria-label="Inbox folders">
              {FOLDERS.map((entry) => {
                const badge = entry.key === 'requests' ? counts.requests : entry.key === 'inbox' ? counts.unread : 0;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    role="tab"
                    aria-selected={folder === entry.key}
                    className={`dm-tab${folder === entry.key ? ' is-active' : ''}`}
                    onClick={() => setFolder(entry.key)}
                  >
                    {entry.label}
                    {badge > 0 && <span className="dm-tab-badge">{badge > 99 ? '99+' : badge}</span>}
                  </button>
                );
              })}
            </div>

            {listError && (
              <p className="dm-inline-error dm-list-error" role="alert">
                <AlertIcon size={13} /> {listError}
              </p>
            )}

            {listLoading ? (
              <div className="dm-list dm-list-loading" role="status" aria-label="Loading conversations">
                {[0, 1, 2, 3].map((row) => (
                  <div key={row} className="dm-row-skeleton">
                    <span className="skel" style={{ width: 42, height: 42, borderRadius: 999 }} />
                    <span className="skel-stack">
                      <span className="skel" style={{ width: '72%', height: 11 }} />
                      <span className="skel" style={{ width: '48%', height: 9 }} />
                    </span>
                  </div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="dm-list-empty">
                <span className="dm-list-empty-icon" aria-hidden="true"><MailIcon size={20} /></span>
                <strong>{empty.title}</strong>
                <p>{empty.body}</p>
              </div>
            ) : (
              <ul className="dm-list">
                {items.map((item) => {
                  const unread = Number(item.unread) || 0;
                  const preview = item.state === 'request'
                    ? (item.isRecipient ? 'Message request' : 'Waiting for acceptance')
                    : item.lastMessagePreview || 'No messages yet';
                  return (
                    <li key={item._id}>
                      <button
                        type="button"
                        className={`dm-row${activeId === item._id ? ' is-active' : ''}${unread > 0 ? ' is-unread' : ''}`}
                        onClick={() => { setActionError(''); selectThread(item._id); }}
                        aria-current={activeId === item._id ? 'true' : undefined}
                      >
                        <span className="dm-avatar" aria-hidden="true">
                          {(item.counterpart?.username?.[0] || '?').toUpperCase()}
                        </span>
                        <span className="dm-row-main">
                          <span className="dm-row-top">
                            <strong>@{item.counterpart?.username || 'unknown'}</strong>
                            <time dateTime={item.lastMessageAt || item.createdAt}>
                              {timeAgo(item.lastMessageAt || item.createdAt)}
                            </time>
                          </span>
                          <span className="dm-row-bottom">
                            <span className="dm-row-preview">
                              {item.state === 'request' && <span className="dm-chip">Request</span>}
                              {preview}
                            </span>
                            {unread > 0 && <span className="dm-unread">{unread > 9 ? '9+' : unread}</span>}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <section className="dm-pane" aria-label="Conversation">
            {threadLoading ? (
              <div className="dm-thread-loading" role="status" aria-label="Loading conversation">
                <span className="skel" style={{ width: '38%', height: 16 }} />
                <span className="skel" style={{ width: '72%', height: 42, marginTop: 20 }} />
                <span className="skel" style={{ width: '54%', height: 42, marginTop: 12 }} />
              </div>
            ) : threadError ? (
              <div className="dm-pane-empty">
                <span className="dm-pane-empty-icon" aria-hidden="true"><AlertIcon size={22} /></span>
                <h2>Conversation unavailable</h2>
                <p>{threadError}</p>
              </div>
            ) : thread ? (
              <DmThread
                data={thread}
                busy={busy}
                error={actionError}
                onAccept={accept}
                onDecline={decline}
                onSend={send}
                onArchive={archive}
                onMute={mute}
                onReport={report}
                onBack={() => selectThread(null)}
              />
            ) : (
              <div className="dm-pane-empty">
                <span className="dm-pane-empty-icon" aria-hidden="true"><MailIcon size={22} /></span>
                <h2>Pick a conversation</h2>
                <p>Your private threads and pending requests live here. Nothing is public.</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
};

export default MessagesPage;
