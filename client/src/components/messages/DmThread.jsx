import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertIcon, ArrowLeftIcon, ClockIcon, CloseIcon, MailIcon } from '../common/icons';

const BUSINESS_INTENT_LABELS = {
  collab: 'Collaboration',
  sponsorship: 'Sponsorship',
  support: 'Support',
  press: 'Press',
  partnership: 'Partnership',
  other: 'Other'
};

const BUSINESS_BUDGET_LABELS = {
  under_500: 'Under $500',
  '500_2000': '$500 - $2,000',
  '2000_plus': '$2,000+'
};

const BusinessBrief = ({ brief }) => {
  if (!brief) return null;
  return (
    <div className="dm-biz-brief">
      <div className="dm-biz-brief-head">
        <span className="business-badge">Business</span>
        <strong>{brief.company}</strong>
      </div>
      <dl className="dm-biz-brief-grid">
        <div><dt>Intent</dt><dd>{BUSINESS_INTENT_LABELS[brief.intent] || brief.intent}</dd></div>
        {brief.budgetBand && (
          <div><dt>Budget</dt><dd>{BUSINESS_BUDGET_LABELS[brief.budgetBand] || brief.budgetBand}</dd></div>
        )}
        {brief.timeline && <div><dt>Timeline</dt><dd>{brief.timeline}</dd></div>}
        {brief.website && <div><dt>Website</dt><dd>{brief.website}</dd></div>}
      </dl>
    </div>
  );
};

const REPORT_REASONS = [
  { value: 'spam', label: 'Spam or a sales pitch' },
  { value: 'harassment', label: 'Harassment or threats' },
  { value: 'hate_speech', label: 'Hate speech' },
  { value: 'sexual_content', label: 'Sexual content' },
  { value: 'other', label: 'Something else' }
];

function formatClock(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDay(value) {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Today';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const DmThread = ({
  data,
  busy,
  error,
  onAccept,
  onDecline,
  onSend,
  onArchive,
  onMute,
  onSetLabels,
  onReport,
  quickReplies = [],
  sharedInbox = null,
  onBack
}) => {
  const { conversation, messages } = data;
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState('spam');
  const [note, setNote] = useState('');
  // Blocking is a separate, heavier action: never pre-selected on a report.
  const [block, setBlock] = useState(false);
  const [reportError, setReportError] = useState('');
  const [reporting, setReporting] = useState(false);
  const [labelDraft, setLabelDraft] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length, conversation._id]);

  useEffect(() => {
    setDraft('');
    setReportOpen(false);
    setBlock(false);
    setReportError('');
  }, [conversation._id]);

  const isRequest = conversation.state === 'request';
  const teamMode = Boolean(sharedInbox);
  const canReply = conversation.state === 'active' && (!teamMode || sharedInbox.role === 'agent');
  const incomingRequest = isRequest && conversation.request?.canRespond;
  const teamReadOnlyRequest = isRequest && teamMode && !conversation.request?.canRespond;
  const outgoingRequest = isRequest && !conversation.request?.canRespond && !teamMode;
  const isActive = conversation.state === 'active';
  const labels = conversation.labels || [];
  const canLabel = !teamMode && (isActive || isRequest);
  const counterpart = conversation.counterpart;

  const saveLabels = async (next) => {
    if (!onSetLabels) return false;
    return onSetLabels(next);
  };

  const addLabel = async (event) => {
    event.preventDefault();
    const label = labelDraft.trim();
    if (!label || labels.length >= 8) return;
    if (labels.some((entry) => entry.toLowerCase() === label.toLowerCase())) {
      setLabelDraft('');
      return;
    }
    const added = await saveLabels([...labels, label.slice(0, 24)]);
    if (added) setLabelDraft('');
  };

  const removeLabel = async (label) => {
    await saveLabels(labels.filter((entry) => entry !== label));
  };

  const submitMessage = async (event) => {
    event?.preventDefault();
    if (!draft.trim() || sending || !isActive) return;
    setSending(true);
    try {
      const sent = await onSend(draft);
      if (sent) setDraft('');
    } finally {
      setSending(false);
    }
  };

  const submitReport = async (event) => {
    event.preventDefault();
    if (reporting) return;
    setReporting(true);
    setReportError('');
    try {
      const ok = await onReport({ reason, note, block });
      if (ok) setReportOpen(false);
    } catch (err) {
      setReportError(err?.response?.data?.message || 'Could not send that report.');
    } finally {
      setReporting(false);
    }
  };

  const day = messages.length ? formatDay(messages[0].createdAt) : '';

  return (
    <div className="dm-thread">
      <header className="dm-thread-head">
        <button type="button" className="icon-btn dm-back" aria-label="Back to conversations" onClick={onBack}>
          <ArrowLeftIcon size={16} />
        </button>

        <span className="dm-avatar dm-avatar-lg" aria-hidden="true">
          {(counterpart?.username?.[0] || '?').toUpperCase()}
        </span>

        <div className="dm-thread-identity">
          <Link to={`/u/${counterpart?.username || ''}`} className="dm-thread-name">
            @{counterpart?.username || 'unknown'}
            {counterpart?.profileType === 'creator_business' && (
              <span className="business-badge">Business</span>
            )}
          </Link>
          <span className="dm-thread-sub">
            {teamMode
              ? `Shared by @${sharedInbox.ownerUsername || 'business'} · ${sharedInbox.role}`
              : conversation.contextLabel || 'Profile message'}
            {!teamMode && isActive && conversation.muted && ' · Muted'}
          </span>
        </div>

        <div className="dm-thread-actions">
          {!teamMode && isActive && (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onMute(!conversation.muted)}
                disabled={busy === 'mute'}
              >
                {conversation.muted ? 'Unmute' : 'Mute'}
              </button>
              {!conversation.archived && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={onArchive}
                  disabled={busy === 'archive'}
                >
                  Archive
                </button>
              )}
            </>
          )}
          {!teamMode && (
            <button
              type="button"
              className="btn btn-ghost btn-sm dm-report-toggle"
              onClick={() => setReportOpen((value) => !value)}
              aria-expanded={reportOpen}
            >
              <AlertIcon size={14} /> Report
            </button>
          )}
        </div>
      </header>

      {canLabel && (
        <div className="dm-label-row" aria-label="Private conversation labels">
          <span className="dm-label-row-title">Labels</span>
          {labels.map((label) => (
            <button
              key={label}
              type="button"
              className="dm-label"
              onClick={() => removeLabel(label)}
              disabled={busy === 'labels'}
              title={`Remove ${label}`}
            >
              {label}
              <CloseIcon size={10} />
            </button>
          ))}
          {labels.length < 8 && (
            <form className="dm-label-form" onSubmit={addLabel}>
              <input
                className="dm-label-input"
                value={labelDraft}
                onChange={(event) => setLabelDraft(event.target.value.slice(0, 24))}
                placeholder="Add label"
                aria-label="Add a private label"
                maxLength={24}
              />
              <button type="submit" className="btn btn-ghost btn-sm" disabled={busy === 'labels' || !labelDraft.trim()}>
                Add
              </button>
            </form>
          )}
        </div>
      )}

      {!teamMode && reportOpen && (
        <form className="dm-report-form" onSubmit={submitReport}>
          <div className="dm-report-head">
            <strong>Report this conversation</strong>
            <span>Reports are private. Blocking is mutual and immediate.</span>
          </div>
          <div className="dm-report-grid">
            <label className="form-group" htmlFor="dm-report-reason">
              <span className="form-label">Reason</span>
              <select
                id="dm-report-reason"
                className="form-input"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              >
                {REPORT_REASONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="form-group" htmlFor="dm-report-note">
              <span className="form-label">What happened?</span>
              <input
                id="dm-report-note"
                className="form-input"
                value={note}
                onChange={(event) => setNote(event.target.value.slice(0, 500))}
                placeholder="Optional context for the moderation team"
              />
            </label>
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={block} onChange={(event) => setBlock(event.target.checked)} />
            Block @{counterpart?.username} as well
          </label>
          {reportError && (
            <p className="dm-inline-error" role="alert"><AlertIcon size={13} /> {reportError}</p>
          )}
          <div className="dm-report-actions">
            <button type="submit" className="btn btn-primary btn-sm" disabled={reporting}>
              {reporting ? 'Sending…' : 'Send report'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReportOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="dm-inline-error dm-thread-error" role="alert">
          <AlertIcon size={14} /> {error}
        </p>
      )}

      {incomingRequest && (
        <section className="dm-request-card" aria-label="Message request">
          <span className="dm-eyebrow">
            <MailIcon size={13} /> First message · {conversation.contextLabel || 'Profile'}
          </span>
          <BusinessBrief brief={conversation.request?.business} />
          <p className="dm-request-text">{conversation.request?.text}</p>
          {conversation.filtered && (
            <p className="dm-request-filter">
              {conversation.filterReason === 'hidden_word'
                ? `Held back by your hidden words${conversation.filterMatched ? ` (${conversation.filterMatched})` : ''}.`
                : conversation.filterReason === 'campaign'
                  ? 'Held back because this opener matches repeated outreach from the same account.'
                  : 'Held back because this account has recent reports.'}
              {' '}It stays out of Requests until you accept.
            </p>
          )}
          <p className="dm-request-note">
            They cannot send anything else until you accept. Declining is silent and gives you
            both space; the sender sees that the request closed, not that you read it.
          </p>
          <div className="dm-request-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onAccept}
              disabled={busy === 'accept'}
            >
              {busy === 'accept' ? 'Accepting…' : 'Accept request'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onDecline}
              disabled={busy === 'decline'}
            >
              {busy === 'decline' ? 'Declining…' : 'Decline silently'}
            </button>
          </div>
        </section>
      )}

      {teamReadOnlyRequest && (
        <section className="dm-request-card" aria-label="Shared message request">
          <span className="dm-eyebrow">First message · shared inbox</span>
          <BusinessBrief brief={conversation.request?.business} />
          <p className="dm-request-text">{conversation.request?.text}</p>
          <p className="dm-request-note">
            Viewer access is read-only. The owner or an agent can accept or decline this request.
          </p>
        </section>
      )}

      {outgoingRequest && (
        <section className="dm-request-card dm-request-card-sent" aria-label="Sent request">
          <span className="dm-eyebrow"><ClockIcon size={13} /> Waiting for a reply</span>
          <BusinessBrief brief={conversation.request?.business} />
          <p className="dm-request-text">{conversation.request?.text}</p>
          <p className="dm-request-note">
            @{counterpart?.username} has not accepted yet. This request expires after 14 days.
            You cannot send another message until they accept.
          </p>
        </section>
      )}

      {!isActive && !isRequest && (
        <section className="dm-request-card">
          <span className="dm-eyebrow">Conversation closed</span>
          <p className="dm-request-note">
            This thread is no longer open. You can message this player again from their profile
            after the cooldown, unless they have blocked you.
          </p>
        </section>
      )}

      {isActive && (
        <>
          <div className="dm-messages" role="log" aria-label={`Messages with @${counterpart?.username || 'player'}`}>
            {day && <div className="dm-day"><span>{day}</span></div>}
            {messages.length === 0 && (
              <div className="dm-empty-thread">
                <MailIcon size={20} />
                <p>No replies yet. Say hello.</p>
              </div>
            )}
            {messages.map((message) => (
              <div key={message._id} className={`dm-message${message.mine ? ' mine' : ''}`}>
                <div className="dm-bubble">
                  <p>{message.text}</p>
                  <time dateTime={message.createdAt}>{formatClock(message.createdAt)}</time>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {canReply && quickReplies.length > 0 && (
            <div className="dm-quick-replies" aria-label="Saved quick replies">
              <span>Quick replies</span>
              {quickReplies.map((reply) => (
                <button
                  key={reply}
                  type="button"
                  className="dm-quick-reply"
                  onClick={() => setDraft(reply)}
                  title={reply}
                >
                  {reply.length > 48 ? `${reply.slice(0, 45)}…` : reply}
                </button>
              ))}
            </div>
          )}

          {canReply && (
          <form className="dm-composer" onSubmit={submitMessage}>
            <textarea
              className="dm-composer-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, 2000))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submitMessage();
                }
              }}
              placeholder={`Message @${counterpart?.username || 'player'}…`}
              rows={2}
              maxLength={2000}
              aria-label="Message text"
            />
            <div className="dm-composer-bar">
              <span className="dm-composer-hint">
                {conversation.muted ? 'Muted: no notification, messages still arrive.' : 'Enter to send · Shift+Enter for a new line'}
              </span>
              <span className={`dm-composer-count${draft.length > 1800 ? ' is-low' : ''}`}>
                {draft.length}/2000
              </span>
              <button type="submit" className="btn btn-primary btn-sm" disabled={sending || !draft.trim()}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
          )}
        </>
      )}

      {isActive && teamMode && !canReply && (
        <p className="dm-team-readonly">
          Viewer access: you can read this shared inbox but cannot reply. Ask the owner for the
          agent role.
        </p>
      )}
    </div>
  );
};

export default DmThread;
