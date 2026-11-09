import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';
import { connectSocket } from '../api/socket';
import DmThread from '../components/messages/DmThread';
import { AlertIcon, CloseIcon, MailIcon, UsersIcon } from '../components/common/icons';

const FOLDERS = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'requests', label: 'Requests' },
  { key: 'filtered', label: 'Filtered' },
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
  filtered: {
    title: 'Nothing filtered',
    body: 'Requests that match your hidden words, or look like repeated bulk outreach, wait here instead of the main request lane.'
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
  const scope = searchParams.get('scope') || 'all';
  const unreadOnly = searchParams.get('unread') === '1';
  const activeId = searchParams.get('thread') || '';
  const teamOwner = searchParams.get('team') || '';
  const sharedMode = Boolean(teamOwner);
  const isBusiness = user?.profileType === 'creator_business';

  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ requests: 0, filtered: 0, unread: 0, inbox: 0 });
  const [quickReplies, setQuickReplies] = useState([]);
  const [savedFilters, setSavedFilters] = useState([]);
  const [teamWorkspaces, setTeamWorkspaces] = useState([]);
  const [teamInvites, setTeamInvites] = useState([]);
  const [teamBusy, setTeamBusy] = useState(null);
  const [teamError, setTeamError] = useState('');
  const [filterName, setFilterName] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  // On narrow screens the list and the thread share one column. Auto-opening
  // the first row there hid the inbox (and the shared-inbox invites) behind a
  // thread the reader never chose, so "Back to conversations" could never win.
  const [listCollapsed, setListCollapsed] = useState(false);
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

  /** Leave the thread and stay on the conversation list. */
  const closeThread = useCallback(() => {
    setListCollapsed(true);
    selectThread(null);
  }, [selectThread]);

  const activeTeam = teamWorkspaces.find((entry) => entry.ownerId === teamOwner) || null;
  const activeTeamRole = activeTeam?.role || 'viewer';
  const folders = sharedMode ? FOLDERS.filter((entry) => entry.key !== 'sent') : FOLDERS;

  const selectTeam = (ownerId) => {
    const next = new URLSearchParams();
    if (ownerId) next.set('team', ownerId);
    next.set('folder', 'inbox');
    setSearchParams(next, { replace: true });
    setThread(null);
    setListCollapsed(false);
    setActionError('');
  };

  const refreshTeams = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get('/messages/team');
      setTeamWorkspaces(Array.isArray(data?.teams) ? data.teams : []);
      setTeamInvites(Array.isArray(data?.invites) ? data.invites : []);
      setTeamError('');
    } catch {
      setTeamWorkspaces([]);
      setTeamInvites([]);
    }
  }, []);

  useEffect(() => {
    if (user) refreshTeams();
  }, [user?._id, refreshTeams]);

  const respondTeamInvite = async (ownerId, accept) => {
    setTeamBusy(ownerId);
    setTeamError('');
    try {
      await axiosInstance.post(`/messages/team/${ownerId}/respond`, { accept });
      await refreshTeams();
      if (accept) selectTeam(ownerId);
    } catch (err) {
      setTeamError(err.response?.data?.message || 'Could not answer that invitation.');
    } finally {
      setTeamBusy(null);
    }
  };

  const setFolder = (key) => {
    const next = new URLSearchParams(searchParams);
    next.set('folder', key);
    next.delete('unread');
    next.delete('thread');
    setSearchParams(next, { replace: true });
    setThread(null);
    setListCollapsed(false);
    setActionError('');
  };

  const setScope = (key) => {
    const next = new URLSearchParams(searchParams);
    if (key === 'all') next.delete('scope');
    else next.set('scope', key);
    next.delete('thread');
    setSearchParams(next, { replace: true });
    setThread(null);
    setListCollapsed(false);
    setActionError('');
  };

  const setUnreadOnly = (value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('unread', '1');
    else next.delete('unread');
    next.delete('thread');
    setSearchParams(next, { replace: true });
    setThread(null);
    setListCollapsed(false);
  };

  const applySavedFilter = (filter) => {
    const next = new URLSearchParams();
    next.set('folder', filter.folder || 'inbox');
    if (filter.scope && filter.scope !== 'all') next.set('scope', filter.scope);
    if (filter.unreadOnly) next.set('unread', '1');
    setSearchParams(next, { replace: true });
    setThread(null);
    setListCollapsed(false);
    setActionError('');
  };

  const saveCurrentFilter = async (event) => {
    event.preventDefault();
    const name = filterName.trim();
    if (!name) return;
    try {
      const { data } = await axiosInstance.patch('/account/dm-settings', {
        savedFilters: [
          ...savedFilters.filter((entry) => entry.name.toLowerCase() !== name.toLowerCase()),
          { name, folder, scope, unreadOnly }
        ]
      });
      setSavedFilters(data.dmSettings?.savedFilters || []);
      setFilterName('');
    } catch (err) {
      setActionError(err.response?.data?.message || 'Could not save that view.');
    }
  };

  const removeSavedFilter = async (name) => {
    try {
      const { data } = await axiosInstance.patch('/account/dm-settings', {
        savedFilters: savedFilters.filter((entry) => entry.name !== name)
      });
      setSavedFilters(data.dmSettings?.savedFilters || []);
    } catch (err) {
      setActionError(err.response?.data?.message || 'Could not remove that view.');
    }
  };

  const refreshList = useCallback(async (showSpinner = false) => {
    if (showSpinner) setListLoading(true);
    try {
      const query = new URLSearchParams({ folder });
      if (!sharedMode && scope !== 'all') query.set('scope', scope);
      if (unreadOnly) query.set('unread', '1');
      const endpoint = sharedMode
        ? `/messages/team/${teamOwner}/conversations?${query.toString()}`
        : `/messages/conversations?${query.toString()}`;
      const { data } = await axiosInstance.get(endpoint);
      setItems(Array.isArray(data.items) ? data.items : []);
      setCounts({
        requests: Number(data?.counts?.requests) || 0,
        filtered: Number(data?.counts?.filtered) || 0,
        unread: Number(data?.counts?.unread) || 0,
        inbox: Number(data?.counts?.inbox) || 0
      });
      setQuickReplies(sharedMode || !Array.isArray(data?.quickReplies) ? [] : data.quickReplies);
      setSavedFilters(sharedMode || !Array.isArray(data?.savedFilters) ? [] : data.savedFilters);
      setListError('');
    } catch (err) {
      setListError(err.response?.data?.message || 'Could not load your inbox.');
    } finally {
      if (showSpinner) setListLoading(false);
    }
  }, [folder, scope, unreadOnly, sharedMode, teamOwner]);

  useEffect(() => {
    refreshList(true);
  }, [refreshList]);

  // Pick the first row on wide screens once the list lands, where the split
  // view can show both columns. A deep link (?thread=…) always wins, and a
  // reader who pressed "Back to conversations" is left on the list.
  useEffect(() => {
    if (activeId || listCollapsed || listLoading || items.length === 0) return;
    if (typeof window === 'undefined' || !window.matchMedia('(min-width: 761px)').matches) return;
    const next = new URLSearchParams(searchParams);
    next.set('thread', items[0]._id);
    setSearchParams(next, { replace: true });
  }, [activeId, listCollapsed, listLoading, items, searchParams, setSearchParams]);

  useEffect(() => {
    if (!activeId) {
      setThread(null);
      setThreadError('');
      return undefined;
    }

    let cancelled = false;
    setThreadLoading(true);
    setThreadError('');

    const threadUrl = sharedMode
      ? `/messages/team/${teamOwner}/conversations/${activeId}`
      : `/messages/conversations/${activeId}`;
    axiosInstance.get(threadUrl)
      .then(({ data }) => {
        if (cancelled) return;
        setThread(data);
        if (data.conversation.state === 'active') {
          const readUrl = sharedMode
            ? `/messages/team/${teamOwner}/conversations/${activeId}/read`
            : `/messages/conversations/${activeId}/read`;
          axiosInstance.post(readUrl).catch(() => {});
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
  }, [activeId, threadNonce, sharedMode, teamOwner]);

  useEffect(() => {
    if (!user || !activeId) return undefined;
    const socket = connectSocket(token);
    const conversationIsOpen = thread?.conversation?.state === 'active';

    // A pending request cannot join the room, so wait until the fetched thread
    // reports it as active. The state is in the dependency list so an accept
    // (local or from another tab) re-runs this effect and joins at that point.
    const join = () => {
      if (conversationIsOpen) socket.emit('join_conversation', { conversationId: activeId });
    };
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
  }, [user?._id, token, activeId, refreshList, thread?.conversation?.state]);

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
    const url = sharedMode
      ? `/messages/team/${teamOwner}/conversations/${activeId}/accept`
      : `/messages/conversations/${activeId}/accept`;
    await axiosInstance.post(url);
    setThreadNonce((value) => value + 1);
    await refreshList();
  });

  const decline = () => runAction('decline', async () => {
    const url = sharedMode
      ? `/messages/team/${teamOwner}/conversations/${activeId}/request`
      : `/messages/conversations/${activeId}/request`;
    await axiosInstance.delete(url);
    setThread(null);
    closeThread();
    await refreshList();
  });

  const send = (text) => runAction('send', async () => {
    const url = sharedMode
      ? `/messages/team/${teamOwner}/conversations/${activeId}/messages`
      : `/messages/conversations/${activeId}/messages`;
    const { data } = await axiosInstance.post(url, { text });
    setThread((previous) => {
      if (!previous) return previous;
      if (previous.messages.some((message) => message._id === data.message?._id)) return previous;
      const additions = [data.message, data.autoReply]
        .filter(Boolean)
        .filter((message, index, list) => list.findIndex((entry) => entry._id === message._id) === index);
      return {
        conversation: { ...previous.conversation, ...data.conversation },
        messages: additions.length ? [...previous.messages, ...additions] : previous.messages
      };
    });
    await refreshList();
    return true;
  });

  const archive = () => runAction('archive', async () => {
    if (sharedMode) return null;
    await axiosInstance.post(`/messages/conversations/${activeId}/archive`);
    setThread(null);
    closeThread();
    await refreshList();
  });

  const mute = (muted) => runAction('mute', async () => {
    if (sharedMode) return null;
    const { data } = await axiosInstance.patch(`/messages/conversations/${activeId}/mute`, { muted });
    setThread((previous) => (previous
      ? { ...previous, conversation: { ...previous.conversation, ...data.conversation } }
      : previous));
    await refreshList();
  });

  const setLabels = (labels) => runAction('labels', async () => {
    if (sharedMode) return false;
    const { data } = await axiosInstance.patch(`/messages/conversations/${activeId}/labels`, { labels });
    setThread((previous) => (previous
      ? { ...previous, conversation: { ...previous.conversation, ...data.conversation } }
      : previous));
    await refreshList();
    return true;
  });

  const report = ({ reason, note, block }) => runAction('report', async () => {
    if (sharedMode) return null;
    await axiosInstance.post(`/messages/conversations/${activeId}/report`, { reason, note, block });
    if (block) {
      setThread(null);
      closeThread();
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

            {(teamWorkspaces.length > 0 || teamInvites.length > 0 || sharedMode) && (
              <div className="dm-team-panel">
                <div className="dm-team-panel-head">
                  <span><UsersIcon size={14} /> Shared inboxes</span>
                </div>
                <div className="dm-team-switcher" role="group" aria-label="Shared inbox">
                  <button
                    type="button"
                    className={`dm-scope-tab${!sharedMode ? ' is-active' : ''}`}
                    onClick={() => selectTeam('')}
                  >
                    My inbox
                  </button>
                  {teamWorkspaces.map((workspace) => (
                    <button
                      key={workspace.ownerId}
                      type="button"
                      className={`dm-scope-tab${teamOwner === workspace.ownerId ? ' is-active' : ''}`}
                      onClick={() => selectTeam(workspace.ownerId)}
                    >
                      @{workspace.username}
                    </button>
                  ))}
                </div>
                {teamInvites.map((invite) => (
                  <div key={invite.ownerId} className="dm-team-invite">
                    <span>@{invite.username} invited you as {invite.role}</span>
                    <div>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => respondTeamInvite(invite.ownerId, true)}
                        disabled={teamBusy === invite.ownerId}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => respondTeamInvite(invite.ownerId, false)}
                        disabled={teamBusy === invite.ownerId}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
                {teamError && <p className="dm-inline-error" role="alert">{teamError}</p>}
              </div>
            )}

            {isBusiness && !sharedMode && (
              <div className="dm-scope-tabs" role="tablist" aria-label="Conversation type">
                {[{ key: 'all', label: 'All' }, { key: 'personal', label: 'Personal' }, { key: 'business', label: 'Business' }].map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    role="tab"
                    aria-selected={scope === entry.key}
                    className={`dm-scope-tab${scope === entry.key ? ' is-active' : ''}`}
                    onClick={() => setScope(entry.key)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            )}

            {!sharedMode && <div className="dm-saved-filters" aria-label="Saved views">
              <button
                type="button"
                className={`dm-scope-tab${unreadOnly ? ' is-active' : ''}`}
                aria-pressed={unreadOnly}
                onClick={() => setUnreadOnly(!unreadOnly)}
              >
                Unread only
              </button>
              {savedFilters.map((filter) => (
                <span key={filter.name} className="dm-saved-filter">
                  <button type="button" onClick={() => applySavedFilter(filter)}>{filter.name}</button>
                  <button
                    type="button"
                    className="dm-saved-filter-remove"
                    aria-label={`Remove ${filter.name} view`}
                    onClick={() => removeSavedFilter(filter.name)}
                  >
                    <CloseIcon size={10} />
                  </button>
                </span>
              ))}
              <details className="dm-save-filter">
                <summary>Save view</summary>
                <form onSubmit={saveCurrentFilter}>
                  <input
                    className="form-input"
                    value={filterName}
                    onChange={(event) => setFilterName(event.target.value.slice(0, 24))}
                    placeholder="View name"
                    maxLength={24}
                    aria-label="Saved view name"
                  />
                  <button type="submit" className="btn btn-ghost btn-sm" disabled={!filterName.trim()}>
                    Save
                  </button>
                </form>
              </details>
            </div>}

            <div className="dm-tabs" role="tablist" aria-label="Inbox folders">
              {folders.map((entry) => {
                const badge = entry.key === 'requests'
                  ? counts.requests
                  : entry.key === 'filtered'
                    ? counts.filtered
                    : entry.key === 'inbox'
                      ? counts.unread
                      : 0;
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
                  const preview = item.filtered
                    ? 'Filtered request'
                    : item.state === 'request'
                      ? (item.isRecipient ? 'Message request' : 'Waiting for acceptance')
                      : item.lastMessagePreview || 'No messages yet';
                  return (
                    <li key={item._id}>
                      <button
                        type="button"
                        className={`dm-row${activeId === item._id ? ' is-active' : ''}${unread > 0 ? ' is-unread' : ''}`}
                        onClick={() => { setActionError(''); setListCollapsed(false); selectThread(item._id); }}
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
                              {item.filtered && <span className="dm-chip dm-chip-filtered">Filtered</span>}
                              {item.state === 'request' && !item.filtered && <span className="dm-chip">Request</span>}
                              {item.businessThread && <span className="dm-chip dm-chip-business">Business</span>}
                              {(item.labels || []).slice(0, 2).map((label) => (
                                <span key={label} className="dm-chip dm-chip-label">{label}</span>
                              ))}
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
                onSetLabels={setLabels}
                onReport={report}
                quickReplies={quickReplies}
                sharedInbox={sharedMode ? { role: activeTeamRole, ownerUsername: activeTeam?.username || '' } : null}
                onBack={closeThread}
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
