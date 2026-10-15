import React, { useState, useEffect, useRef } from 'react';
import { getSocket } from '../../api/socket';

const ROLE_LABELS = { owner: '👑', admin: '🛡️', moderator: '⚔️', member: '' };

const MessageInput = ({ channelId, canWrite, placeholder }) => {
  const [text, setText]           = useState('');
  const [sending, setSending]     = useState(false);
  const typingTimeoutRef          = useRef(null);
  const socket                    = getSocket();

  // Typing indicator: emit start, then stop after 2s idle
  const handleChange = (e) => {
    setText(e.target.value);
    if (!socket || !channelId) return;
    socket.emit('typing_start', { channelId });
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket?.emit('typing_stop', { channelId });
    }, 2000);
  };

  const handleSend = () => {
    if (!text.trim() || !socket || !channelId || sending) return;
    setSending(true);
    socket.emit('send_message', { channelId, text: text.trim() });
    setText('');
    // Stop typing indicator immediately on send
    clearTimeout(typingTimeoutRef.current);
    socket.emit('typing_stop', { channelId });
    setSending(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{ padding: '0.75rem 1rem 1rem', borderTop: '1px solid var(--border)', background: 'var(--bg-card)', flexShrink: 0 }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input
          className="form-input"
          style={{ flex: 1, borderRadius: '12px', background: 'var(--bg-elevated)', fontSize: '0.92rem' }}
          placeholder={canWrite ? (placeholder || 'Send a message...') : '🔒 You don\'t have permission to send messages here.'}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={!canWrite}
          maxLength={1000}
        />
        <button
          className="btn btn-primary btn-sm"
          onClick={handleSend}
          disabled={!canWrite || !text.trim() || sending}
          style={{ borderRadius: '10px', padding: '0.5rem 0.85rem' }}
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default MessageInput;
