import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import axiosInstance from '../../api/axiosInstance';
import { CloseIcon } from '../common/icons';

const REASONS = [
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'hate_speech', label: 'Hate speech' },
  { value: 'nsfw', label: 'Not safe for work' },
  { value: 'other', label: 'Something else' }
];

/**
 * Report a message to the server's moderators.
 * The response is intentionally generic: a reporter cannot learn whether the
 * target was already reported or what a moderator decided.
 */
const ReportModal = ({ isOpen, onClose, communityId, target, onDone }) => {
  const [reason, setReason] = useState('spam');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setReason('spam');
    setNote('');
    setError('');
    setSent(false);
    setSending(false);
  }, [isOpen, target?._id]);

  if (!isOpen || !target) return null;

  const submit = async (event) => {
    event.preventDefault();
    setSending(true);
    setError('');
    try {
      await axiosInstance.post(`/communities/${communityId}/reports`, {
        targetType: 'message',
        targetId: target._id,
        reason,
        note: note.trim()
      });
      setSent(true);
      onDone?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not send that report.');
    } finally {
      setSending(false);
    }
  };

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="report-title">
      <div className="modal-box" onClick={event => event.stopPropagation()} style={{ maxWidth: '420px' }}>
        <div className="modal-header-row">
          <h2 id="report-title" className="modal-title" style={{ margin: 0 }}>Report message</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>

        <p className="text-muted" style={{ fontSize: '0.8rem', marginBottom: '0.75rem' }}>
          Moderators of this server will see the message and your reason. {target.senderId?.username || 'The author'} is not told who reported them.
        </p>

        {error && <div className="form-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
        {sent && <div className="form-success" style={{ marginBottom: '0.75rem' }}>Report received.</div>}

        <form onSubmit={submit}>
          <div className="form-group">
            <label className="form-label" htmlFor="report-reason">Reason</label>
            <select
              id="report-reason"
              className="form-input"
              value={reason}
              onChange={event => setReason(event.target.value)}
            >
              {REASONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="report-note">Details (optional)</label>
            <textarea
              id="report-note"
              className="form-textarea"
              rows={3}
              maxLength={300}
              value={note}
              onChange={event => setNote(event.target.value)}
              placeholder="Anything a moderator should know"
            />
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-danger" disabled={sending || sent}>
              {sending ? 'Sending…' : sent ? 'Sent' : 'Report'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

export default ReportModal;
