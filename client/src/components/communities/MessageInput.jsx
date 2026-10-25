import React, { useEffect, useRef, useState } from 'react';
import { getSocket } from '../../api/socket';
import { CAP, hasCapability } from '../../utils/permissions';

const MAX_LENGTH = 1000;

const MessageInput = ({
  channelId,
  canWrite,
  slowModeSeconds = 0,
  permissions = [],
  onNotice,
  placeholder
}) => {
  const [text, setText] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const typingTimeoutRef = useRef(null);

  const bypassSlowmode = hasCapability(permissions, CAP.BYPASS_SLOWMODE);
  const slowmodeForMe = !bypassSlowmode ? slowModeSeconds : 0;

  // Reset the composer when switching channels
  useEffect(() => {
    setText('');
    setCooldown(0);
    clearTimeout(typingTimeoutRef.current);
  }, [channelId]);

  // Cooldown countdown
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => () => clearTimeout(typingTimeoutRef.current), []);

  const handleChange = (event) => {
    const value = event.target.value.slice(0, MAX_LENGTH);
    setText(value);

    const socket = getSocket();
    if (!socket || !channelId) return;

    socket.emit('typing_start', { channelId });
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      getSocket()?.emit('typing_stop', { channelId });
    }, 2000);
  };

  const send = () => {
    const value = text.trim();
    if (!value || cooldown > 0) return;

    // Resolve the socket at send time: it may connect after the first render.
    const socket = getSocket();
    if (!socket || !socket.connected) {
      onNotice?.('Still connecting to chat — try again in a second.');
      return;
    }

    socket.emit('send_message', { channelId, text: value });
    setText('');

    clearTimeout(typingTimeoutRef.current);
    socket.emit('typing_stop', { channelId });

    if (slowmodeForMe > 0) setCooldown(slowmodeForMe);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  const disabled = !canWrite || cooldown > 0;
  const remaining = MAX_LENGTH - text.length;

  return (
    <div className="chat-composer">
      <div className="chat-composer-row">
        <textarea
          className="form-input chat-composer-input"
          rows={1}
          placeholder={
            !canWrite
              ? 'You don’t have permission to send messages here.'
              : cooldown > 0
                ? `Slowmode active (${cooldown}s)…`
                : (placeholder || 'Send a message…')
          }
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          maxLength={MAX_LENGTH}
          aria-label="Message"
        />
        <button
          type="button"
          className="btn btn-primary btn-sm chat-send-btn"
          onClick={send}
          disabled={disabled || !text.trim()}
        >
          {cooldown > 0 ? `${cooldown}s` : 'Send'}
        </button>
      </div>
      <div className="chat-composer-meta">
        <span className="text-muted" style={{ fontSize: '0.7rem' }}>
          Enter to send • Shift+Enter for a new line
        </span>
        {text.length > 0 && (
          <span className={`char-count${remaining < 50 ? ' warn' : ''}`}>{remaining}</span>
        )}
      </div>
    </div>
  );
};

export default MessageInput;
