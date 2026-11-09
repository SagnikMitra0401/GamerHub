import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axiosInstance from '../../api/axiosInstance';
import { useAuth } from '../../context/AuthContext';
import { AlertIcon, CloseIcon, MailIcon } from '../common/icons';

const INTENTS = [
  { value: 'collab', label: 'Collaboration' },
  { value: 'sponsorship', label: 'Sponsorship' },
  { value: 'support', label: 'Support' },
  { value: 'press', label: 'Press' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'other', label: 'Other' }
];

const BUDGETS = [
  { value: '', label: 'Not specified' },
  { value: 'under_500', label: 'Under $500' },
  { value: '500_2000', label: '$500 - $2,000' },
  { value: '2000_plus', label: '$2,000+' }
];

/**
 * First contact from a profile. The server decides whether this becomes a
 * pending request or, for a mutual with an open inbox, a real thread.
 */
const MessageRequestModal = ({ open, profile, onClose }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const textareaRef = useRef(null);
  const isBusinessSender = user?.profileType === 'creator_business';
  const maxLength = isBusinessSender ? 600 : 300;
  const [text, setText] = useState('');
  const [intent, setIntent] = useState('collab');
  const [company, setCompany] = useState('');
  const [website, setWebsite] = useState('');
  const [budgetBand, setBudgetBand] = useState('');
  const [timeline, setTimeline] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    setText('');
    setIntent('collab');
    setCompany('');
    setWebsite('');
    setBudgetBand('');
    setTimeline('');
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
  const paused = mode === 'paused' || profile.dm?.availability === 'paused';
  const away = profile.dm?.availability === 'away';
  const allowed = !paused && profile.dm?.allowed !== false && mode !== 'none';
  const remaining = maxLength - text.length;
  const businessReady = !isBusinessSender || Boolean(intent && company.trim());

  const send = async (event) => {
    event.preventDefault();
    if (!allowed || sending) return;
    setSending(true);
    setError('');
    try {
      const { data } = await axiosInstance.post('/messages/requests', {
        recipientId: profile._id,
        text,
        context: { type: 'profile' },
        ...(isBusinessSender
          ? {
              intent,
              company: company.trim(),
              website: website.trim(),
              budgetBand: budgetBand || null,
              timeline: timeline.trim()
            }
          : {})
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
              {paused && 'This player has paused new messages. Existing conversations are unaffected.'}
            </p>

            {away && profile.dm?.awayMessage && (
              <p className="dm-modal-away">{profile.dm.awayMessage}</p>
            )}

            {allowed ? (
              <>
                {isBusinessSender && (
                  <div className="dm-biz-fields">
                    <div className="dm-biz-fields-head">
                      <span className="business-badge">Business</span>
                      <span>Your verified business brief is shown before the message.</span>
                    </div>
                    <div className="dm-biz-fields-grid">
                      <label className="form-group" htmlFor="dm-business-intent">
                        <span className="form-label">Intent</span>
                        <select
                          id="dm-business-intent"
                          className="form-input"
                          value={intent}
                          onChange={(event) => setIntent(event.target.value)}
                        >
                          {INTENTS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="form-group" htmlFor="dm-business-company">
                        <span className="form-label">Company or brand</span>
                        <input
                          id="dm-business-company"
                          className="form-input"
                          value={company}
                          onChange={(event) => setCompany(event.target.value.slice(0, 80))}
                          placeholder="Studio name"
                          maxLength={80}
                          required
                        />
                      </label>
                      <label className="form-group" htmlFor="dm-business-budget">
                        <span className="form-label">Budget</span>
                        <select
                          id="dm-business-budget"
                          className="form-input"
                          value={budgetBand}
                          onChange={(event) => setBudgetBand(event.target.value)}
                        >
                          {BUDGETS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="form-group" htmlFor="dm-business-timeline">
                        <span className="form-label">Timeline</span>
                        <input
                          id="dm-business-timeline"
                          className="form-input"
                          value={timeline}
                          onChange={(event) => setTimeline(event.target.value.slice(0, 40))}
                          placeholder="Next month"
                          maxLength={40}
                        />
                      </label>
                    </div>
                    <label className="form-group" htmlFor="dm-business-website">
                      <span className="form-label">Website (optional)</span>
                      <input
                        id="dm-business-website"
                        className="form-input"
                        value={website}
                        onChange={(event) => setWebsite(event.target.value)}
                        placeholder="https://studio.example"
                        maxLength={200}
                      />
                      <span className="settings-help">If supplied, it must match your verified domain.</span>
                    </label>
                  </div>
                )}

                <label className="form-group" htmlFor="dm-first-message">
                  <span className="form-label">First message</span>
                  <textarea
                    id="dm-first-message"
                    ref={textareaRef}
                    className="form-input dm-modal-textarea"
                    value={text}
                    onChange={(event) => setText(event.target.value.slice(0, maxLength))}
                    placeholder={isBusinessSender
                      ? 'Give the creator the short version of the brief.'
                      : 'Say what you play, or why you are reaching out. Keep it short.'}
                    rows={4}
                    maxLength={maxLength}
                    required
                  />
                </label>
                <div className="dm-modal-meta">
                  <span>
                    {isBusinessSender
                      ? 'No links in the message. Requests expire in 14 days.'
                      : 'No links, media or read receipts. Requests expire in 14 days.'}
                  </span>
                  <span className={remaining < 30 ? 'is-low' : ''}>{remaining} left</span>
                </div>
                {error && (
                  <p className="dm-inline-error" role="alert">
                    <AlertIcon size={13} /> {error}
                  </p>
                )}
                <div className="dm-modal-actions">
                  <button type="submit" className="btn btn-primary btn-sm" disabled={sending || !text.trim() || !businessReady}>
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
