import React, { useEffect, useRef, useState } from 'react';
import axiosInstance from '../../api/axiosInstance';
import { getSocket } from '../../api/socket';
import { CAP, hasCapability } from '../../utils/permissions';
import { CloseIcon, MicIcon, PaperclipIcon, SendIcon } from '../common/icons';
import { useSpeechCompose } from '../../hooks/useSpeechCompose';

const MAX_LENGTH = 1000;

const MessageInput = ({
  channelId,
  canWrite,
  slowModeSeconds = 0,
  permissions = [],
  replyTo = null,
  onCancelReply,
  onNotice,
  placeholder
}) => {
  const [text, setText] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [attachment, setAttachment] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);

  const canAttach = hasCapability(permissions, CAP.ATTACH_FILES);
  const bypassSlowmode = hasCapability(permissions, CAP.BYPASS_SLOWMODE);
  const slowmodeForMe = !bypassSlowmode ? slowModeSeconds : 0;

  const { start: startDictation, stop: stopDictation, listening, supported: dictationSupported } =
    useSpeechCompose({
      onTranscript: (transcript) => {
        // Dictation only fills the draft; the user still presses Send.
        setText(previous => `${previous}${previous ? ' ' : ''}${transcript}`.slice(0, MAX_LENGTH));
      },
      onError: (message) => onNotice?.(message)
    });

  // Reset the composer when switching channels
  useEffect(() => {
    setText('');
    setCooldown(0);
    setAttachment(null);
    stopDictation();
    clearTimeout(typingTimeoutRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const uploadFile = async (file) => {
    if (!file) return;
    if (!canAttach) {
      onNotice?.('You do not have permission to attach files here.');
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await axiosInstance.post(
        `/communities/channels/${channelId}/attachments`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      setAttachment(data.attachment);
    } catch (err) {
      onNotice?.(err.response?.data?.message || 'That image could not be uploaded.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const send = () => {
    const value = text.trim();
    if ((!value && !attachment) || cooldown > 0 || uploading || sending) return;

    // Resolve the socket at send time: it may connect after the first render.
    const socket = getSocket();
    if (!socket || !socket.connected) {
      onNotice?.('Still connecting to chat — try again in a second.');
      return;
    }

    setSending(true);
    socket.emit('send_message', {
      channelId,
      text: value,
      attachmentIds: attachment ? [attachment._id] : [],
      replyTo: replyTo ? { messageId: replyTo._id } : null
    });
    setText('');
    setAttachment(null);
    onCancelReply?.();

    clearTimeout(typingTimeoutRef.current);
    socket.emit('typing_stop', { channelId });

    if (slowmodeForMe > 0) setCooldown(slowmodeForMe);
    // The server clears this on its own error event; a short lock only prevents
    // an accidental double-submit.
    setTimeout(() => setSending(false), 400);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
    if (event.key === 'Escape' && replyTo) onCancelReply?.();
  };

  const disabled = !canWrite || cooldown > 0 || uploading;
  const remaining = MAX_LENGTH - text.length;
  const canSend = !disabled && (text.trim().length > 0 || !!attachment);

  return (
    <div className="chat-composer">
      {replyTo && (
        <div className="chat-reply-banner">
          <div className="chat-reply-banner-text">
            Replying to <strong>{replyTo.senderId?.username || 'message'}</strong>
            <span className="chat-reply-banner-preview">
              {(replyTo.text || '').slice(0, 90) || 'attachment'}
            </span>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Cancel reply"
            title="Cancel reply"
            onClick={() => onCancelReply?.()}
          >
            <CloseIcon size={13} />
          </button>
        </div>
      )}

      {attachment && (
        <div className="chat-attach-banner">
          <span className="chat-attach-name">
            {attachment.mimeType.replace('image/', '').toUpperCase()} •{' '}
            {Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Remove attachment"
            title="Remove attachment"
            onClick={() => setAttachment(null)}
          >
            <CloseIcon size={13} />
          </button>
        </div>
      )}

      <div className="chat-composer-row">
        {canAttach && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="chat-file-input"
              onChange={(event) => uploadFile(event.target.files?.[0])}
              aria-label="Attach an image"
            />
            <button
              type="button"
              className="chat-composer-tool"
              title={uploading ? 'Uploading…' : 'Attach an image (max 8 MB)'}
              aria-label="Attach an image"
              disabled={disabled || !!attachment}
              onClick={() => fileInputRef.current?.click()}
            >
              <PaperclipIcon size={16} />
            </button>
          </>
        )}

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

        {dictationSupported && (
          <button
            type="button"
            className={`chat-composer-tool${listening ? ' listening' : ''}`}
            title={listening ? 'Stop dictating' : 'Dictate a message'}
            aria-label={listening ? 'Stop dictating' : 'Dictate a message'}
            aria-pressed={listening}
            onClick={listening ? stopDictation : startDictation}
            disabled={!canWrite}
          >
            <MicIcon size={16} />
          </button>
        )}

        <button
          type="button"
          className="btn btn-primary btn-sm chat-send-btn"
          onClick={send}
          disabled={!canSend}
          aria-label="Send message"
        >
          {cooldown > 0 ? `${cooldown}s` : uploading ? '…' : <SendIcon size={15} />}
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
