import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axiosInstance from '../../api/axiosInstance';
import { AlertIcon, CloseIcon, MailIcon } from '../common/icons';

const MAX = 300;

/**
 * First contact from a profile. The server decides whether this becomes a
 * pending request or, for a mutual with an open inbox, a real thread.
 */
const MessageRequestModal = ({ open, profile, onClose }) => {
  const navigate = useNavigate();
  const textareaRef = useRef(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    setText('');
    setError('');
    setSent(null);
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 30);

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open || !profile) return null;

  const mode = profile.dm?.mode || 'request';
  const allowed = profile.dm?.allowed !== false && mode !== 'none';
  const remaining = MAX - text.length;

  const send = async (event) => {
    event.preventDefault();
    if (!allowed || sending) return;
    setSending(true);
    setError('');
    try {
      const { data } = await axiosInstance.post('/messages/requests', {
        recipientId: profile._id,
        text,
        context: { type: 'profile' }
      });
      if (data?.direct) {
        navigate(`/messages?thread=${data.conversation._id}`);
        onClose();
        return;
      }
      setSent(data?.conversation || {});
    } catch (err) {
      setError(err.response?.data?.message || 'Could not send that request.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="dm-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="dm-modal" role="dialog" aria-modal="true" aria-labelledby="dm-request-title">
        <header className="dm-modal-head">
          <div>
            <span className="dm-eyebrow">Private message</span>
            <h2 id="dm-request-title">Message @{profile.username}</h2>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </header>

        {sent ? (
          <div className="dm-modal-sent">
            <span className="dm-modal-sent-icon" aria-hidden="true"><MailIcon size={22} /></span>
            <h3>Request sent</h3>
            <p>
              @{profile.username} will see it in Requests. They can accept, ignore it, or decline
              silently. You will not see read receipts before they accept.
            </p>
            <div className="dm-modal-actions">
              <Link className="btn btn-primary btn-sm" to="/messages?folder=sent" onClick={onClose}>
                Open sent requests
              </Link>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                Back to profile
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={send} className="dm-modal-body">
            <p className={`dm-modal-policy ${allowed ? '' : 'is-blocked'}`}>
              {mode === 'inbox' && 'This player is open to messages from you. This opens a thread immediately.'}
              {mode === 'request' && 'This player accepts message requests. Your first message is all they see until they accept.'}
              {mode === 'verified' && (allowed
                ? 'This player accepts requests from verified accounts.'
                : 'This player only accepts messages from verified accounts.')}
              {mode === 'none' && 'This player is not accepting messages.'}
            </p>

            {allowed ? (
              <>
                <label className="form-group" htmlFor="dm-first-message">
                  <span className="form-label">First message</span>
                  <textarea
                    id="dm-first-message"
                    ref={textareaRef}
                    className="form-input dm-modal-textarea"
                    value={text}
                    onChange={(event) => setText(event.target.value.slice(0, MAX))}
                    placeholder="Say what you play, or why you are reaching out. Keep it short."
                    rows={4}
                    maxLength={MAX}
                    required
                  />
                </label>
                <div className="dm-modal-meta">
                  <span>No links, media or read receipts. Requests expire in 14 days.</span>
                  <span className={remaining < 30 ? 'is-low' : ''}>{remaining} left</span>
                </div>
                {error && (
                  <p className="dm-inline-error" role="alert">
                    <AlertIcon size={13} /> {error}
                  </p>
                )}
                <div className="dm-modal-actions">
                  <button type="submit" className="btn btn-primary btn-sm" disabled={sending || !text.trim()}>
                    {sending ? 'Sending…' : 'Send request'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <div className="dm-modal-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                  Close
                </button>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
};

export default MessageRequestModal;
