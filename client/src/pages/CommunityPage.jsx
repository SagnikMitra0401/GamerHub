import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';
import { connectSocket, getSocket } from '../api/socket';
import CreateChannelModal from '../components/communities/CreateChannelModal';
import MessageInput from '../components/communities/MessageInput';

const ROLE_LEVELS  = { member: 0, moderator: 1, admin: 2, owner: 3 };
const ROLE_LABELS  = { owner: '👑 Owner', admin: '🛡️ Admin', moderator: '⚔️ Mod', member: '' };
const ROLE_COLORS  = { owner: '#ffd700', admin: '#a855f7', moderator: '#3b82f6', member: 'var(--text-secondary)' };

function roleAtLeast(userRole, minRole) {
  return (ROLE_LEVELS[userRole] ?? -1) >= (ROLE_LEVELS[minRole] ?? 99);
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date)) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(date).toLocaleDateString();
}

const CommunityPage = () => {
  const { slug }      = useParams();
  const navigate      = useNavigate();
  const { user, token } = useAuth();

  const [community, setCommunity]       = useState(null);
  const [channels, setChannels]         = useState([]);
  const [callerRole, setCallerRole]     = useState(null);
  const [activeChannel, setActiveChannel] = useState(null);
  const [messages, setMessages]         = useState([]);
  const [typingUsers, setTypingUsers]   = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [joining, setJoining]           = useState(false);
  const [showChannelModal, setShowChannelModal] = useState(false);

  const messagesEndRef = useRef(null);
  const socketRef      = useRef(null);

  // ── Fetch community data ──────────────────────────────────────────────────
  useEffect(() => {
    const fetchCommunity = async () => {
      setLoading(true);
      try {
        const { data } = await axiosInstance.get(`/communities/${slug}`);
        setCommunity(data.community);
        setChannels(data.channels || []);
        setCallerRole(data.callerRole);
        if (data.channels?.length > 0) setActiveChannel(data.channels[0]);
      } catch (err) {
        setError(err.response?.data?.message || 'Community not found.');
      } finally {
        setLoading(false);
      }
    };
    fetchCommunity();
  }, [slug]);

  // ── Socket setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!community || !user) return;
    const sock = connectSocket(token);
    socketRef.current = sock;

    sock.on('new_message', (msg) => {
      setMessages(prev => [...prev, msg]);
    });

    sock.on('message_deleted', ({ messageId }) => {
      setMessages(prev => prev.map(m => m._id === messageId ? { ...m, isDeleted: true, text: 'This message was deleted' } : m));
    });

    sock.on('user_typing', ({ username }) => {
      setTypingUsers(prev => prev.includes(username) ? prev : [...prev, username]);
    });

    sock.on('user_stopped_typing', ({ username }) => {
      setTypingUsers(prev => prev.filter(u => u !== username));
    });

    sock.on('error_msg', ({ message }) => {
      alert(message);
    });

    return () => {
      sock.off('new_message');
      sock.off('message_deleted');
      sock.off('user_typing');
      sock.off('user_stopped_typing');
      sock.off('error_msg');
    };
  }, [community, user, token]);

  // ── Join channel room when active channel changes ─────────────────────────
  useEffect(() => {
    if (!activeChannel || !community || !socketRef.current) return;

    // Fetch history
    const fetchMessages = async () => {
      try {
        const { data } = await axiosInstance.get(`/communities/channels/${activeChannel._id}/messages`);
        setMessages(data);
      } catch {
        setMessages([]);
      }
    };
    fetchMessages();

    socketRef.current.emit('join_channel', {
      channelId:   activeChannel._id,
      communityId: community._id
    });
    setTypingUsers([]);
  }, [activeChannel, community]);

  // ── Auto-scroll to bottom on new messages ────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Join community ────────────────────────────────────────────────────────
  const handleJoin = async () => {
    setJoining(true);
    try {
      await axiosInstance.post(`/communities/${community._id}/join`);
      setCallerRole('member');
      setCommunity(prev => ({
        ...prev,
        members: [...(prev.members || []), { userId: user._id, role: 'member' }]
      }));
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to join.');
    } finally {
      setJoining(false);
    }
  };

  // ── Channel created callback ──────────────────────────────────────────────
  const handleChannelCreated = (newChannel) => {
    setChannels(prev => [...prev, newChannel]);
    setActiveChannel(newChannel);
  };

  const isMember = !!callerRole;
  const canWrite = isMember && activeChannel && roleAtLeast(callerRole, activeChannel.minRoleToWrite);
  const canCreateChannel = callerRole && roleAtLeast(callerRole, 'admin');
  const memberCount = community?.members?.length || 0;

  if (loading) return <div className="page"><div className="spinner" /></div>;
  if (error)   return (
    <div className="page" style={{ textAlign: 'center', paddingTop: '4rem' }}>
      <p style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>😕</p>
      <h2>{error}</h2>
      <button className="btn btn-primary" onClick={() => navigate('/communities')}>Browse Communities</button>
    </div>
  );

  return (
    <div className="community-layout">
      {/* ── Left: Channels + Members Sidebar ─────────────────────────────── */}
      <aside className="community-sidebar">
        {/* Community Header */}
        <div className="community-sidebar-header">
          <span style={{ fontSize: '1.6rem' }}>{community.icon}</span>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontWeight: 800, fontSize: '0.92rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {community.name}
            </div>
            <div className="text-muted" style={{ fontSize: '0.72rem' }}>
              {memberCount} member{memberCount !== 1 ? 's' : ''}
              {community.isPrivate ? ' • 🔒 Private' : ''}
            </div>
          </div>
        </div>

        {/* Join / Leave Button */}
        {user && !isMember && (
          <button className="btn btn-primary btn-sm" style={{ margin: '0.5rem 0.75rem', width: 'calc(100% - 1.5rem)' }} onClick={handleJoin} disabled={joining}>
            {joining ? 'Joining...' : '➕ Join Community'}
          </button>
        )}

        {/* Channels */}
        <div className="community-section-label">
          <span>TEXT CHANNELS</span>
          {canCreateChannel && (
            <button
              className="channel-add-btn"
              onClick={() => setShowChannelModal(true)}
              title="Create Channel"
            >＋</button>
          )}
        </div>

        <nav className="channel-list">
          {channels.map(ch => (
            <button
              key={ch._id}
              className={`channel-item${activeChannel?._id === ch._id ? ' active' : ''}`}
              onClick={() => setActiveChannel(ch)}
            >
              <span className="channel-hash">{ch.type === 'announcement' ? '📢' : '#'}</span>
              <span className="channel-name">{ch.name}</span>
              {ch.minRoleToWrite !== 'member' && (
                <span className="text-muted" style={{ fontSize: '0.65rem', marginLeft: 'auto' }}>🔒</span>
              )}
            </button>
          ))}
        </nav>

        {/* Members List */}
        <div className="community-section-label" style={{ marginTop: '1rem' }}>MEMBERS — {memberCount}</div>
        <div className="member-list">
          {(community.members || []).map((m, i) => {
            const memberUser = typeof m.userId === 'object' && m.userId !== null ? m.userId : null;
            const uname = memberUser?.username;
            const initial = uname ? uname[0].toUpperCase() : '?';

            if (!uname) {
              return (
                <div key={i} className="member-item">
                  <div className="member-avatar">{initial}</div>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>Member</div>
                    {ROLE_LABELS[m.role] && (
                      <div style={{ fontSize: '0.68rem', color: ROLE_COLORS[m.role] }}>
                        {ROLE_LABELS[m.role]}
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            return (
              <Link
                key={i}
                to={`/u/${uname}`}
                className="member-item"
              >
                <div className="member-avatar">{initial}</div>
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {uname}
                  </div>
                  {ROLE_LABELS[m.role] && (
                    <div style={{ fontSize: '0.68rem', color: ROLE_COLORS[m.role] }}>
                      {ROLE_LABELS[m.role]}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </aside>

      {/* ── Right: Chat Area ─────────────────────────────────────────────── */}
      <main className="community-chat">
        {/* Channel Header */}
        {activeChannel ? (
          <>
            <div className="chat-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.1rem', color: 'var(--text-secondary)' }}>
                  {activeChannel.type === 'announcement' ? '📢' : '#'}
                </span>
                <span style={{ fontWeight: 800, fontSize: '1rem' }}>{activeChannel.name}</span>
                {activeChannel.topic && (
                  <span className="text-muted" style={{ fontSize: '0.8rem', borderLeft: '1px solid var(--border)', paddingLeft: '0.6rem' }}>
                    {activeChannel.topic}
                  </span>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className={`chat-messages ${activeChannel.isProtected ? 'protected-chat' : ''}`}>
              {messages.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                  <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>👋</p>
                  <p>This is the beginning of <strong>#{activeChannel.name}</strong>.</p>
                  {!isMember && <p style={{ fontSize: '0.85rem' }}>Join this community to start chatting!</p>}
                </div>
              ) : (
                messages.map((msg, i) => {
                  const sender = msg.senderId;
                  const senderRole = community.members?.find(m =>
                    (typeof m.userId === 'object' ? m.userId._id : m.userId)?.toString() === sender?._id?.toString()
                  )?.role;

                  const isAuthor = user && sender?._id?.toString() === user._id?.toString();
                  const canDelete = isAuthor || (callerRole && ['owner', 'admin', 'moderator'].includes(callerRole));

                  return (
                    <div key={msg._id || i} className={`chat-message ${msg.isDeleted ? 'deleted' : ''}`}>
                      <div className="chat-avatar">{sender?.username?.[0]?.toUpperCase() || '?'}</div>
                      <div className="chat-message-body">
                        <div className="chat-message-header">
                          <Link to={`/u/${sender?.username}`} className="chat-sender-name">
                            {sender?.username || 'Unknown'}
                          </Link>
                          {sender?.level && (
                            <span className="level-badge" style={{ fontSize: '0.65rem' }}>Lv{sender.level}</span>
                          )}
                          {senderRole && ROLE_LABELS[senderRole] && (
                            <span style={{ fontSize: '0.68rem', color: ROLE_COLORS[senderRole] }}>{ROLE_LABELS[senderRole]}</span>
                          )}
                          <span className="chat-timestamp">{timeAgo(msg.createdAt)}</span>

                          {canDelete && !msg.isDeleted && (
                            <button
                              type="button"
                              className="chat-msg-delete-btn"
                              title="Delete message"
                              onClick={() => {
                                if (window.confirm('Delete this message?')) {
                                  socketRef.current?.emit('delete_message', {
                                    messageId: msg._id,
                                    channelId: activeChannel._id
                                  });
                                }
                              }}
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                        <p className={`chat-message-text ${msg.isDeleted ? 'text-tombstone' : ''}`}>
                          {msg.isDeleted ? '🚫 This message was deleted' : msg.text}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}

              {/* Typing Indicator */}
              {typingUsers.length > 0 && (
                <div className="typing-indicator">
                  <span className="typing-dots">
                    <span /><span /><span />
                  </span>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginLeft: '0.4rem' }}>
                    {typingUsers.length === 1
                      ? `${typingUsers[0]} is typing...`
                      : `${typingUsers.slice(0, 2).join(', ')} are typing...`}
                  </span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <MessageInput
              channelId={activeChannel._id}
              communityId={community._id}
              canWrite={canWrite}
              slowModeSeconds={activeChannel.slowModeSeconds || 0}
              placeholder={`Message #${activeChannel.name}`}
            />
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            <p>Select a channel to start chatting.</p>
          </div>
        )}
      </main>

      {/* Modals */}
      <CreateChannelModal
        isOpen={showChannelModal}
        onClose={() => setShowChannelModal(false)}
        communityId={community._id}
        onCreated={handleChannelCreated}
      />
    </div>
  );
};

export default CommunityPage;
