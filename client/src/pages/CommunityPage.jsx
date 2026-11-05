import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';
import { connectSocket, getSocket } from '../api/socket';

import MessageInput from '../components/communities/MessageInput';
import CreateChannelModal from '../components/communities/CreateChannelModal';
import RoleManagerModal from '../components/communities/RoleManagerModal';
import ChannelSettingsModal from '../components/communities/ChannelSettingsModal';
import AuditLogModal from '../components/communities/AuditLogModal';
import CommunitySettingsModal from '../components/communities/CommunitySettingsModal';
import CommunitySigil from '../components/communities/CommunitySigil';
import MessageItem from '../components/communities/MessageItem';
import ForumChannel from '../components/communities/ForumChannel';
import ChannelSearchModal from '../components/communities/ChannelSearchModal';
import ReportsModal from '../components/communities/ReportsModal';
import ReportModal from '../components/communities/ReportModal';
import ConfirmModal from '../components/common/ConfirmModal';
import { ChatSkeleton, CommunitySkeleton } from '../components/common/Skeleton';
import {
  ScrollIcon, SettingsIcon, PlusIcon, MenuIcon, CloseIcon, SearchIcon, AlertIcon
} from '../components/common/icons';

import {
  CAP,
  ROLE_LABELS,
  ROLE_COLORS,
  hasCapability,
  roleAtLeast
} from '../utils/permissions';

const CommunityPage = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user, token } = useAuth();

  const [community, setCommunity] = useState(null);
  const [channels, setChannels] = useState([]);
  const [memberCount, setMemberCount] = useState(0);
  const [callerRole, setCallerRole] = useState(null);
  const [permissions, setPermissions] = useState([]);

  const [activeChannelId, setActiveChannelId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [typingUsers, setTypingUsers] = useState({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [joining, setJoining] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const [modal, setModal] = useState(null); // 'roles' | 'audit' | 'settings' | 'channel'
  const [channelToEdit, setChannelToEdit] = useState(null);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [socketReady, setSocketReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // userId -> { status, activeGame } from live presence events
  const [presenceMap, setPresenceMap] = useState({});

  // Phase 7 interaction surface
  const [replyTo, setReplyTo] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [mutedUsers, setMutedUsers] = useState([]);

  const socketRef = useRef(null);
  const endRef = useRef(null);

  const activeChannel = channels.find(c => c._id === activeChannelId) || null;

  // Mobile channel drawer: close on route change and on Escape.
  useEffect(() => { setDrawerOpen(false); }, [slug]);
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKeyDown = (event) => { if (event.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  // ── Data loading ───────────────────────────────────────────────────────────
  const loadCommunity = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await axiosInstance.get(`/communities/${slug}`);
      setCommunity(data.community);
      setChannels(data.channels || []);
      setMemberCount(data.memberCount ?? data.community?.members?.length ?? 0);
      setCallerRole(data.callerRole || null);
      setPermissions(data.callerPermissions || []);
      setError(null);
      setActiveChannelId(prev => {
        if (prev && (data.channels || []).some(c => c._id === prev)) return prev;
        return data.channels?.[0]?._id || null;
      });
    } catch (err) {
      setError({
        status: err.response?.status,
        message: err.response?.data?.message || 'Server not found.'
      });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [slug]);

  useEffect(() => { loadCommunity(); }, [loadCommunity]);

  // A reply belongs to the channel it was started in.
  useEffect(() => { setReplyTo(null); }, [activeChannelId]);

  // Personal mutes: their messages are hidden from my view only.
  useEffect(() => {
    if (!user) { setMutedUsers([]); return undefined; }
    let cancelled = false;
    axiosInstance.get('/users/me/muted')
      .then(({ data }) => { if (!cancelled) setMutedUsers(data.mutedUsers || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user?._id]);

  // Live presence badges in the member sidebar (works even before you join).
  useEffect(() => {
    const sock = getSocket();
    if (!sock) return undefined;

    const onPresence = (payload) => {
      if (!payload?.userId) return;
      setPresenceMap(prev => ({
        ...prev,
        [payload.userId]: { status: payload.status, activeGame: payload.activeGame }
      }));
    };

    sock.on('presence_change', onPresence);
    return () => { sock.off('presence_change', onPresence); };
  }, [user?._id]);

  // ── Socket wiring ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!community || !user) return undefined;

    const sock = connectSocket(token);
    socketRef.current = sock;

    const handleConnect = () => setSocketReady(true);
    if (sock.connected) setSocketReady(true);

    const onNewMessage = (msg) => {
      setMessages(prev => (prev.some(m => m._id === msg._id) ? prev : [...prev, msg]));
    };
    const onMessageDeleted = ({ messageId }) => {
      setMessages(prev => prev.map(m => (
        m._id === messageId ? { ...m, isDeleted: true, text: 'This message was deleted' } : m
      )));
    };

    // Broadcasts carry counts only; each client keeps its own "mine" flag so a
    // reaction from someone else never clears the current user's highlight.
    const onReactionUpdated = ({ messageId, reactions }) => {
      setMessages(prev => prev.map(message => {
        if (message._id !== messageId) return message;
        const previous = message.reactions || [];
        return {
          ...message,
          reactions: (reactions || []).map(reaction => ({
            ...reaction,
            mine: previous.some(entry => entry.emoji === reaction.emoji && entry.mine)
          }))
        };
      }));
    };

    const markPinned = (messageId, pinned) => {
      setMessages(prev => prev.map(message => (
        message._id === messageId ? { ...message, pinned } : message
      )));
    };
    const onPinned = ({ messageId }) => markPinned(messageId, true);
    const onUnpinned = ({ messageId }) => markPinned(messageId, false);

    const onTimedOut = ({ timeoutUntil }) => {
      setNotice(`You are timed out until ${new Date(timeoutUntil).toLocaleTimeString()} — you can read, but not post.`);
    };
    const onTyping = ({ username }) => {
      setTypingUsers(prev => ({ ...prev, [username]: Date.now() }));
    };
    const onStopTyping = ({ username }) => {
      setTypingUsers(prev => {
        const next = { ...prev };
        delete next[username];
        return next;
      });
    };
    const onErrorMsg = ({ message }) => setNotice(message);
    const onJoined = () => setNotice('');

    const onChannelCreated = (channel) => {
      setChannels(prev => (prev.some(c => c._id === channel._id) ? prev : [...prev, channel]));
    };
    const onChannelUpdated = (channel) => {
      setChannels(prev => prev.map(c => (c._id === channel._id ? { ...c, ...channel } : c)));
    };
    const onChannelDeleted = ({ channelId }) => {
      setChannels(prev => prev.filter(c => c._id !== channelId));
      setActiveChannelId(prev => (prev === channelId ? null : prev));
    };
    const onMembershipRevoked = () => loadCommunity({ silent: true });
    const onCommunityUpdated = () => loadCommunity({ silent: true });
    const onMemberEvent = () => loadCommunity({ silent: true });
    const onCommunityDeleted = () => navigate('/communities');

    sock.on('connect', handleConnect);
    sock.on('joined_channel', onJoined);
    sock.on('new_message', onNewMessage);
    sock.on('message_deleted', onMessageDeleted);
    sock.on('reaction_updated', onReactionUpdated);
    sock.on('message_pinned', onPinned);
    sock.on('message_unpinned', onUnpinned);
    sock.on('member_timed_out', onTimedOut);
    sock.on('user_typing', onTyping);
    sock.on('user_stopped_typing', onStopTyping);
    sock.on('error_msg', onErrorMsg);
    sock.on('channel_created', onChannelCreated);
    sock.on('channel_updated', onChannelUpdated);
    sock.on('channel_deleted', onChannelDeleted);
    sock.on('community_updated', onCommunityUpdated);
    sock.on('membership_revoked', onMembershipRevoked);
    sock.on('member_added', onMemberEvent);
    sock.on('member_left', onMemberEvent);
    sock.on('member_kicked', onMemberEvent);
    sock.on('member_role_updated', onMemberEvent);
    sock.on('community_deleted', onCommunityDeleted);

    return () => {
      sock.off('connect', handleConnect);
      sock.off('joined_channel', onJoined);
      sock.off('new_message', onNewMessage);
      sock.off('message_deleted', onMessageDeleted);
      sock.off('reaction_updated', onReactionUpdated);
      sock.off('message_pinned', onPinned);
      sock.off('message_unpinned', onUnpinned);
      sock.off('member_timed_out', onTimedOut);
      sock.off('user_typing', onTyping);
      sock.off('user_stopped_typing', onStopTyping);
      sock.off('error_msg', onErrorMsg);
      sock.off('channel_created', onChannelCreated);
      sock.off('channel_updated', onChannelUpdated);
      sock.off('channel_deleted', onChannelDeleted);
      sock.off('community_updated', onCommunityUpdated);
      sock.off('membership_revoked', onMembershipRevoked);
      sock.off('member_added', onMemberEvent);
      sock.off('member_left', onMemberEvent);
      sock.off('member_kicked', onMemberEvent);
      sock.off('member_role_updated', onMemberEvent);
      sock.off('community_deleted', onCommunityDeleted);
    };
  }, [community?._id, user?._id, token, loadCommunity, navigate]);

  // Keep a valid active channel after deletes/reloads
  useEffect(() => {
    if (!channels.length) return;
    if (!activeChannelId || !channels.some(c => c._id === activeChannelId)) {
      setActiveChannelId(channels[0]._id);
    }
  }, [channels, activeChannelId]);

  // ── Channel history ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeChannel || !callerRole) {
      setMessages([]);
      return undefined;
    }
    let cancelled = false;
    setMessagesLoading(true);
    setTypingUsers({});

    axiosInstance.get(`/communities/channels/${activeChannel._id}/messages`)
      .then(({ data }) => { if (!cancelled) setMessages(data.messages || []); })
      .catch(() => { if (!cancelled) setMessages([]); })
      .finally(() => { if (!cancelled) setMessagesLoading(false); });

    return () => { cancelled = true; };
  }, [activeChannel?._id, callerRole]);

  // Join the socket room once we are connected and allowed to read
  useEffect(() => {
    if (!socketReady || !activeChannel || !callerRole) return;
    socketRef.current?.emit('join_channel', { channelId: activeChannel._id });
  }, [socketReady, activeChannel?._id, callerRole]);

  // Expire typing indicators
  useEffect(() => {
    const timer = setInterval(() => {
      setTypingUsers(prev => {
        const now = Date.now();
        const next = {};
        for (const [name, ts] of Object.entries(prev)) {
          if (now - ts < 6000) next[name] = ts;
        }
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  // Auto-scroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const joinServer = async () => {
    setJoining(true);
    setNotice('');
    try {
      await axiosInstance.post(`/communities/${community._id}/join`);
      await loadCommunity({ silent: true });
    } catch (err) {
      setNotice(err.response?.data?.message || 'Could not join this server.');
    } finally {
      setJoining(false);
    }
  };

  const leaveServer = async () => {
    try {
      await axiosInstance.post(`/communities/${community._id}/leave`);
      setConfirmLeave(false);
      await loadCommunity({ silent: true });
    } catch (err) {
      setNotice(err.response?.data?.message || 'Could not leave this server.');
      setConfirmLeave(false);
    }
  };

  const deleteMessage = (messageId) => {
    socketRef.current?.emit('delete_message', { messageId });
  };

  const reactToMessage = async (message, emoji) => {
    if (!activeChannelId) return;
    try {
      const { data } = await axiosInstance.post(
        `/communities/channels/${activeChannelId}/messages/${message._id}/react`,
        { emoji }
      );
      setMessages(prev => prev.map(row => (
        row._id === message._id ? { ...row, reactions: data.reactions } : row
      )));
    } catch (err) {
      setNotice(err.response?.data?.message || 'Could not add that reaction.');
    }
  };

  const pinMessage = async (message) => {
    if (!activeChannelId) return;
    try {
      const { data } = await axiosInstance[
        message.pinned ? 'delete' : 'post'
      ](`/communities/channels/${activeChannelId}/messages/${message._id}/pin`);
      setMessages(prev => prev.map(row => (
        row._id === message._id ? { ...row, pinned: data.pinned } : row
      )));
    } catch (err) {
      setNotice(err.response?.data?.message || 'Could not pin that message.');
    }
  };

  const jumpToChannel = (channelId) => {
    if (!channelId) return;
    if (!channels.some(channel => channel._id === channelId)) return;
    setActiveChannelId(channelId);
    setDrawerOpen(false);
  };

  // ── Render guards ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="page">
        <div className="container"><CommunitySkeleton /></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page" style={{ textAlign: 'center', paddingTop: '4rem' }}>
        <h2>{error.message}</h2>
        <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => navigate('/communities')}>
          Browse servers
        </button>
      </div>
    );
  }

  if (!community) return null;

  const canManageChannel = hasCapability(permissions, CAP.MANAGE_CHANNELS);
  const canManageRoles = hasCapability(permissions, CAP.MANAGE_ROLES);
  const canKick = hasCapability(permissions, CAP.KICK_MEMBERS);
  const canViewAudit = hasCapability(permissions, CAP.VIEW_AUDIT_LOG);
  const canViewReports = hasCapability(permissions, CAP.VIEW_REPORTS);
  const canManageServer = hasCapability(permissions, CAP.MANAGE_SERVER);
  const isMember = !!callerRole;

  // Personal mutes hide content from this view only — the server still
  // delivers it, so nobody can mistake a mute for a moderation action.
  const mutedSet = new Set(mutedUsers.map(String));
  const visibleMessages = messages.filter(
    message => !mutedSet.has(String(message.senderId?._id ?? message.senderId))
  );

  const canWrite = isMember && activeChannel
    && hasCapability(permissions, CAP.SEND_MESSAGES)
    && roleAtLeast(callerRole, activeChannel.minRoleToWrite)
    && (activeChannel.type !== 'announcement' || roleAtLeast(callerRole, 'moderator'));

  const visibleMembers = community.members || [];
  const typingNames = Object.keys(typingUsers);

  return (
    <div className={`community-layout${drawerOpen ? ' drawer-open' : ''}`}>
      {/* ── Sidebar (slides in on phones and tablets) ─────────────────────── */}
      {drawerOpen && (
        <button
          type="button"
          className="community-scrim"
          aria-label="Close channels"
          tabIndex={-1}
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <aside className={`community-sidebar${drawerOpen ? ' open' : ''}`} id="community-sidebar">
        <div className="community-sidebar-header">
          <CommunitySigil name={community.name} icon={community.icon} size={34} />
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div className="community-title" title={community.name}>{community.name}</div>
            <div className="community-subtitle">
              {memberCount} member{memberCount === 1 ? '' : 's'}
              {community.isPrivate ? ' • Private' : ''}
            </div>
          </div>
          <div className="community-header-actions">
            <button
              type="button"
              className="icon-btn sidebar-close"
              title="Close channels"
              aria-label="Close channels"
              onClick={() => setDrawerOpen(false)}
            ><CloseIcon size={16} /></button>
            {canViewAudit && (
              <button className="icon-btn" title="Audit log" aria-label="Audit log" onClick={() => setModal('audit')}>
                <ScrollIcon size={15} />
              </button>
            )}
            {canManageServer && (
              <button className="icon-btn" title="Server settings" aria-label="Server settings" onClick={() => setModal('settings')}>
                <SettingsIcon size={15} />
              </button>
            )}
          </div>
        </div>

        {!isMember && (
          community.isPrivate ? (
            <div className="invite-only">
              Invite-only server. Ask an admin to add you.
            </div>
          ) : user ? (
            <button
              className="btn btn-primary btn-sm"
              style={{ margin: '0.5rem 0.75rem', width: 'calc(100% - 1.5rem)' }}
              onClick={joinServer}
              disabled={joining}
            >
              {joining ? 'Joining…' : 'Join server'}
            </button>
          ) : (
            <Link
              to="/login"
              className="btn btn-primary btn-sm"
              style={{ margin: '0.5rem 0.75rem', width: 'calc(100% - 1.5rem)', textAlign: 'center' }}
            >
              Sign in to join
            </Link>
          )
        )}

        {isMember && callerRole !== 'owner' && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ margin: '0.5rem 0.75rem', width: 'calc(100% - 1.5rem)' }}
            onClick={() => setConfirmLeave(true)}
          >
            Leave server
          </button>
        )}

        <div className="community-section-label">
          <span>TEXT CHANNELS</span>
          {canManageChannel && (
            <button
              className="channel-add-btn"
              onClick={() => setShowCreateChannel(true)}
              title="Create channel"
              aria-label="Create channel"
            >＋</button>
          )}
        </div>

        <nav className="channel-list">
          {channels.map(channel => (
            <div key={channel._id} className={`channel-row${channel._id === activeChannelId ? ' active' : ''}`}>
              <button
                className="channel-item"
                onClick={() => { setActiveChannelId(channel._id); setDrawerOpen(false); }}
                title={channel.topic || `#${channel.name}`}
              >
                <span className="channel-hash">{channel.type === 'announcement' ? '!' : '#'}</span>
                <span className="channel-name">{channel.name}</span>
                {channel.slowModeSeconds > 0 && <span className="channel-flag" title={`Slowmode ${channel.slowModeSeconds}s`}>{channel.slowModeSeconds}s</span>}
                {channel.minRoleToWrite !== 'member' && <span className="channel-flag" title={`Only ${channel.minRoleToWrite}s can post`}>locked</span>}
              </button>
              {canManageChannel && (
                <button
                  className="channel-settings-btn"
                  title={`Settings for #${channel.name}`}
                  aria-label={`Settings for ${channel.name}`}
                  onClick={() => { setChannelToEdit(channel); setModal('channel'); }}
                ><SettingsIcon size={13} /></button>
              )}
            </div>
          ))}
          {channels.length === 0 && (
            <p className="text-muted" style={{ fontSize: '0.78rem', padding: '0 0.9rem' }}>
              No channels visible to your role.
            </p>
          )}
        </nav>

        <div className="community-section-label">
          <span>MEMBERS — {memberCount}</span>
          {(canManageRoles || canKick) && (
            <button
              className="channel-add-btn"
              onClick={() => setModal('roles')}
              title="Manage members and roles"
              aria-label="Manage members and roles"
            ><PlusIcon size={13} /></button>
          )}
        </div>

        <div className="member-list">
          {visibleMembers.map((member, index) => {
            const name = member.userId?.username;
            if (!name) return null;

            const memberId = String(member.userId?._id || '');
            const presence = presenceMap[memberId] || member.userId?.presence;

            return (
              <Link key={member.userId?._id || index} to={`/u/${name}`} className="member-item">
                <div className="member-avatar">{name[0].toUpperCase()}</div>
                <div style={{ overflow: 'hidden' }}>
                  <div className="member-name">{name}</div>
                  {presence?.status === 'in_game' && presence.activeGame ? (
                    <div className="member-presence playing" title={`Playing ${presence.activeGame}`}>
                      {presence.activeGame}
                    </div>
                  ) : presence?.status === 'online' ? (
                    <div className="member-presence online">Online</div>
                  ) : null}
                  {member.role !== 'member' && (
                    <div className="member-role" style={{ color: ROLE_COLORS[member.role] }}>
                      {ROLE_LABELS[member.role]}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
          {memberCount > visibleMembers.length && (
            <p className="text-muted" style={{ fontSize: '0.72rem', padding: '0.35rem 0.6rem' }}>
              +{memberCount - visibleMembers.length} more
            </p>
          )}
        </div>
      </aside>

      {/* ── Chat ──────────────────────────────────────────────────────────── */}
      <main className="community-chat">
        {notice && (
          <div className="chat-notice" role="status">
            <span>{notice}</span>
            <button onClick={() => setNotice('')} aria-label="Dismiss"><CloseIcon size={14} /></button>
          </div>
        )}

        {!isMember ? (
          <div className="chat-locked">
            <button
              type="button"
              className="btn btn-ghost btn-sm channel-drawer-toggle"
              aria-controls="community-sidebar"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <MenuIcon size={17} /> Channels &amp; members
            </button>
            <h3>Join {community.name} to read and send messages</h3>
            <p className="text-muted" style={{ maxWidth: '360px' }}>
              {community.description || 'Members of this server can chat in its channels.'}
            </p>
            {!community.isPrivate && user && (
              <button className="btn btn-primary" onClick={joinServer} disabled={joining}>
                {joining ? 'Joining…' : 'Join server'}
              </button>
            )}
            {!user && <Link to="/login" className="btn btn-primary">Sign in to join</Link>}
          </div>
        ) : activeChannel ? (
          <>
            <div className="chat-header">
              <button
                type="button"
                className="channel-drawer-toggle"
                aria-label="Open channels and members"
                aria-controls="community-sidebar"
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen(true)}
              >
                <MenuIcon size={18} />
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', minWidth: 0 }}>
                <span style={{ fontSize: '1.1rem', color: 'var(--text-secondary)' }}>
                  {activeChannel.type === 'announcement' ? '!' : '#'}
                </span>
                <span style={{ fontWeight: 800, fontSize: '1rem' }}>{activeChannel.name}</span>
                {activeChannel.topic && (
                  <span className="chat-topic">{activeChannel.topic}</span>
                )}
                {activeChannel.slowModeSeconds > 0 && (
                  <span className="chat-badge" title="Slowmode">{activeChannel.slowModeSeconds}s</span>
                )}
                {activeChannel.retentionDays > 0 && (
                  <span className="chat-badge" title="Messages auto-delete">{activeChannel.retentionDays}d</span>
                )}
                {activeChannel.type === 'forum' && <span className="chat-badge">forum</span>}
              </div>

              <div className="chat-header-actions">
                <button
                  type="button"
                  className="icon-btn"
                  title="Search messages & pins"
                  aria-label="Search messages and pins"
                  onClick={() => setSearchOpen(true)}
                >
                  <SearchIcon size={16} />
                </button>
                {canViewReports && (
                  <button
                    type="button"
                    className="icon-btn"
                    title="Report queue"
                    aria-label="Open the report queue"
                    onClick={() => setReportsOpen(true)}
                  >
                    <AlertIcon size={16} />
                  </button>
                )}
              </div>
            </div>

            {activeChannel.type === 'forum' ? (
              <ForumChannel
                communityId={community._id}
                channel={activeChannel}
                permissions={permissions}
                canWrite={isMember}
                onNotice={setNotice}
              />
            ) : (
            <>
            <div className={`chat-messages ${activeChannel.isProtected ? 'protected-chat' : ''}`}>
              {messagesLoading ? (
                <ChatSkeleton />
              ) : messages.length === 0 ? (
                <div className="chat-empty">
                  <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>#{activeChannel.name}</p>
                  <p>This is the beginning of <strong>#{activeChannel.name}</strong>.</p>
                </div>
              ) : (
                visibleMessages.map(message => {
                  const sender = message.senderId || {};
                  const role = message.communityRole
                    || community.members?.find(m => String(m.userId?._id || m.userId) === String(sender._id))?.role;

                  return (
                    <MessageItem
                      key={message._id}
                      message={message}
                      channelId={activeChannel._id}
                      me={user}
                      permissions={permissions}
                      communityRole={role}
                      canWrite={canWrite}
                      onDelete={deleteMessage}
                      onReply={setReplyTo}
                      onReact={reactToMessage}
                      onPin={pinMessage}
                      onReport={setReportTarget}
                    />
                  );
                })
              )}

              {typingNames.length > 0 && (
                <div className="typing-indicator">
                  <span className="typing-dots"><span /><span /><span /></span>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginLeft: '0.4rem' }}>
                    {typingNames.length === 1
                      ? `${typingNames[0]} is typing…`
                      : `${typingNames.slice(0, 2).join(', ')} are typing…`}
                  </span>
                </div>
              )}
              <div ref={endRef} />
            </div>

            <MessageInput
              channelId={activeChannel._id}
              communityId={community._id}
              canWrite={canWrite}
              slowModeSeconds={activeChannel.slowModeSeconds || 0}
              permissions={permissions}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
              onNotice={setNotice}
              placeholder={`Message #${activeChannel.name}`}
            />
            </>
            )}
          </>
        ) : (
          <div className="chat-locked">
            <p>Select a channel to start chatting.</p>
          </div>
        )}
      </main>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      <RoleManagerModal
        isOpen={modal === 'roles'}
        onClose={() => setModal(null)}
        community={community}
        callerRole={callerRole}
        permissions={permissions}
        onChanged={() => loadCommunity({ silent: true })}
      />

      <AuditLogModal
        isOpen={modal === 'audit'}
        onClose={() => setModal(null)}
        communityId={community._id}
      />

      <CommunitySettingsModal
        isOpen={modal === 'settings'}
        onClose={() => setModal(null)}
        community={community}
        onSaved={() => loadCommunity({ silent: true })}
        onDeleted={() => navigate('/communities')}
      />

      <ChannelSettingsModal
        isOpen={modal === 'channel'}
        onClose={() => { setModal(null); setChannelToEdit(null); }}
        communityId={community._id}
        channel={channels.find(c => c._id === channelToEdit?._id) || channelToEdit}
        onSaved={(updated) => setChannels(prev => prev.map(c => (c._id === updated._id ? { ...c, ...updated } : c)))}
        onDeleted={(channelId) => {
          setChannels(prev => prev.filter(c => c._id !== channelId));
          setActiveChannelId(prev => (prev === channelId ? null : prev));
        }}
      />

      <CreateChannelModal
        isOpen={showCreateChannel}
        onClose={() => setShowCreateChannel(false)}
        communityId={community._id}
        onCreated={(channel) => {
          setChannels(prev => [...prev, channel]);
          setActiveChannelId(channel._id);
        }}
      />

      <ChannelSearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        communityId={community._id}
        channelId={activeChannelId}
        onJump={jumpToChannel}
      />

      <ReportsModal
        isOpen={reportsOpen}
        onClose={() => setReportsOpen(false)}
        communityId={community._id}
      />

      <ReportModal
        isOpen={!!reportTarget}
        onClose={() => setReportTarget(null)}
        communityId={community._id}
        target={reportTarget}
        onDone={() => setNotice('Report received. A moderator will review it.')}
      />

      <ConfirmModal
        isOpen={confirmLeave}
        title="Leave server"
        message={`Leave “${community.name}”? You will lose access to its channels until you join again.`}
        confirmText="Leave"
        isDanger
        onConfirm={leaveServer}
        onCancel={() => setConfirmLeave(false)}
      />
    </div>
  );
};

export default CommunityPage;
