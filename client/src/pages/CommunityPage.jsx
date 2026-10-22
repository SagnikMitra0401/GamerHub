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
import ConfirmModal from '../components/common/ConfirmModal';

import {
  CAP,
  ROLE_LABELS,
  ROLE_COLORS,
  hasCapability,
  roleAtLeast
} from '../utils/permissions';

const timeAgo = (date) => {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(date).toLocaleDateString();
};

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
  // userId -> { status, activeGame } from live presence events
  const [presenceMap, setPresenceMap] = useState({});

  const socketRef = useRef(null);
  const endRef = useRef(null);

  const activeChannel = channels.find(c => c._id === activeChannelId) || null;

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

  // ── Render guards ──────────────────────────────────────────────────────────
  if (loading) return <div className="page"><div className="spinner" /></div>;

  if (error) {
    return (
      <div className="page" style={{ textAlign: 'center', paddingTop: '4rem' }}>
        <p style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>{error.status === 403 ? '🔒' : '😕'}</p>
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
  const canManageServer = hasCapability(permissions, CAP.MANAGE_SERVER);
  const isMember = !!callerRole;

  const canWrite = isMember && activeChannel
    && hasCapability(permissions, CAP.SEND_MESSAGES)
    && roleAtLeast(callerRole, activeChannel.minRoleToWrite)
    && (activeChannel.type !== 'announcement' || roleAtLeast(callerRole, 'moderator'));

  const visibleMembers = community.members || [];
  const typingNames = Object.keys(typingUsers);

  return (
    <div className="community-layout">
      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <aside className="community-sidebar">
        <div className="community-sidebar-header">
          <span style={{ fontSize: '1.6rem' }}>{community.icon}</span>
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div className="community-title" title={community.name}>{community.name}</div>
            <div className="community-subtitle">
              {memberCount} member{memberCount === 1 ? '' : 's'}
              {community.isPrivate ? ' • 🔒 Private' : ''}
            </div>
          </div>
          <div className="community-header-actions">
            {canViewAudit && (
              <button className="icon-btn" title="Audit log" aria-label="Audit log" onClick={() => setModal('audit')}>📜</button>
            )}
            {canManageServer && (
              <button className="icon-btn" title="Server settings" aria-label="Server settings" onClick={() => setModal('settings')}>⚙️</button>
            )}
          </div>
        </div>

        {!isMember && (
          community.isPrivate ? (
            <div className="invite-only">
              🔒 Invite-only server. Ask an admin to add you.
            </div>
          ) : user ? (
            <button
              className="btn btn-primary btn-sm"
              style={{ margin: '0.5rem 0.75rem', width: 'calc(100% - 1.5rem)' }}
              onClick={joinServer}
              disabled={joining}
            >
              {joining ? 'Joining…' : '➕ Join server'}
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
                onClick={() => setActiveChannelId(channel._id)}
                title={channel.topic || `#${channel.name}`}
              >
                <span className="channel-hash">{channel.type === 'announcement' ? '📢' : '#'}</span>
                <span className="channel-name">{channel.name}</span>
                {channel.slowModeSeconds > 0 && <span className="channel-flag" title={`Slowmode ${channel.slowModeSeconds}s`}>⏱</span>}
                {channel.minRoleToWrite !== 'member' && <span className="channel-flag" title={`Only ${channel.minRoleToWrite}s can post`}>🔒</span>}
              </button>
              {canManageChannel && (
                <button
                  className="channel-settings-btn"
                  title={`Settings for #${channel.name}`}
                  aria-label={`Settings for ${channel.name}`}
                  onClick={() => { setChannelToEdit(channel); setModal('channel'); }}
                >⚙️</button>
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
            >⚙</button>
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
                      🟣 {presence.activeGame}
                    </div>
                  ) : presence?.status === 'online' ? (
                    <div className="member-presence online">🟢 Online</div>
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
            <button onClick={() => setNotice('')} aria-label="Dismiss">✕</button>
          </div>
        )}

        {!isMember ? (
          <div className="chat-locked">
            <p style={{ fontSize: '2rem', margin: 0 }}>👋</p>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '1.1rem', color: 'var(--text-secondary)' }}>
                  {activeChannel.type === 'announcement' ? '📢' : '#'}
                </span>
                <span style={{ fontWeight: 800, fontSize: '1rem' }}>{activeChannel.name}</span>
                {activeChannel.topic && (
                  <span className="chat-topic">{activeChannel.topic}</span>
                )}
                {activeChannel.slowModeSeconds > 0 && (
                  <span className="chat-badge" title="Slowmode">⏱ {activeChannel.slowModeSeconds}s</span>
                )}
                {activeChannel.retentionDays > 0 && (
                  <span className="chat-badge" title="Messages auto-delete">🗓 {activeChannel.retentionDays}d</span>
                )}
              </div>
            </div>

            <div className={`chat-messages ${activeChannel.isProtected ? 'protected-chat' : ''}`}>
              {messagesLoading ? (
                <div className="spinner" />
              ) : messages.length === 0 ? (
                <div className="chat-empty">
                  <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>#{activeChannel.name}</p>
                  <p>This is the beginning of <strong>#{activeChannel.name}</strong>.</p>
                </div>
              ) : (
                messages.map((message, index) => {
                  const sender = message.senderId || {};
                  const role = message.communityRole
                    || community.members?.find(m => String(m.userId?._id || m.userId) === String(sender._id))?.role;
                  const isAuthor = user && String(sender._id) === String(user._id);
                  const canDelete = !message.isDeleted
                    && (isAuthor || hasCapability(permissions, CAP.MANAGE_MESSAGES));

                  return (
                    <div key={message._id || index} className={`chat-message${message.isDeleted ? ' deleted' : ''}`}>
                      <div className="chat-avatar">{sender.username?.[0]?.toUpperCase() || '?'}</div>
                      <div className="chat-message-body">
                        <div className="chat-message-header">
                          <Link to={`/u/${sender.username || ''}`} className="chat-sender-name">
                            {sender.username || 'Unknown'}
                          </Link>
                          {sender.level && (
                            <span className="level-badge" style={{ fontSize: '0.65rem' }}>Lv{sender.level}</span>
                          )}
                          {role && role !== 'member' && (
                            <span style={{ fontSize: '0.68rem', color: ROLE_COLORS[role] }}>{ROLE_LABELS[role]}</span>
                          )}
                          <span className="chat-timestamp">{timeAgo(message.createdAt)}</span>
                          {canDelete && (
                            <button
                              type="button"
                              className="chat-msg-delete-btn"
                              title="Delete message"
                              aria-label="Delete message"
                              onClick={() => deleteMessage(message._id)}
                            >🗑️</button>
                          )}
                        </div>
                        <p className={`chat-message-text${message.isDeleted ? ' text-tombstone' : ''}`}>
                          {message.isDeleted ? '🚫 This message was deleted' : message.text}
                        </p>
                      </div>
                    </div>
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
              onNotice={setNotice}
              placeholder={`Message #${activeChannel.name}`}
            />
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
