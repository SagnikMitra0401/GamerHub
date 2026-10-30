import React, { useCallback, useEffect, useState } from 'react';
import axiosInstance from '../../api/axiosInstance';
import { CloseIcon, UsersIcon, ServerIcon, ClockIcon } from '../common/icons';

const dateLabel = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
};

/**
 * Invitations the caller has received.
 *
 * Nothing is joined until the Accept button is pressed — the whole point of the
 * consent engine is that this modal, not the inviter, is where membership
 * happens.
 */
const InvitationInbox = ({ isOpen, onClose, onAccepted }) => {
  const [tab, setTab] = useState('received');
  const [received, setReceived] = useState([]);
  const [sent, setSent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [inbox, outbox] = await Promise.all([
        axiosInstance.get('/invitations/inbox'),
        axiosInstance.get('/invitations/sent')
      ]);
      setReceived(Array.isArray(inbox.data.items) ? inbox.data.items : []);
      setSent(Array.isArray(outbox.data.items) ? outbox.data.items : []);
    } catch {
      setError('Could not load your invitations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setTab('received');
    load();
  }, [isOpen, load]);

  const respond = async (invitation, action) => {
    setBusy(`${invitation._id}:${action}`);
    setError('');
    try {
      const { data } = await axiosInstance.post(`/invitations/${invitation._id}/${action}`);
      setReceived(prev => prev.filter(item => item._id !== invitation._id));
      if (action === 'accept') {
        onAccepted?.(data);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'That invitation could not be updated.');
      // A stale invitation (accepted elsewhere, expired) should disappear.
      load();
    } finally {
      setBusy(null);
    }
  };

  if (!isOpen) return null;

  const rows = tab === 'received' ? received : sent;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Invitations">
      <div className="modal-box invitation-box">
        <div className="modal-header-row">
          <div>
            <h2 className="modal-title">Invitations</h2>
            <p className="text-muted">Join only what you agree to.</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close invitations">
            <CloseIcon />
          </button>
        </div>

        <div className="invite-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'received'}
            className={`invite-tab${tab === 'received' ? ' active' : ''}`}
            onClick={() => setTab('received')}
          >
            Received {received.length > 0 && <span className="invite-count">{received.length}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'sent'}
            className={`invite-tab${tab === 'sent' ? ' active' : ''}`}
            onClick={() => setTab('sent')}
          >
            Sent
          </button>
        </div>

        {error && <div className="form-error">{error}</div>}

        {loading ? (
          <div className="spinner" />
        ) : rows.length === 0 ? (
          <div className="search-empty">
            <UsersIcon size={22} />
            <p>{tab === 'received' ? 'No pending invitations.' : 'You have not sent any invitations.'}</p>
          </div>
        ) : (
          <ul className="invite-list">
            {rows.map(invitation => (
              <li key={invitation._id} className="invite-row">
                <span className="invite-icon" aria-hidden="true">
                  {invitation.targetType === 'squad' ? <UsersIcon size={16} /> : <ServerIcon size={16} />}
                </span>
                <div className="invite-body">
                  <p className="invite-title">{invitation.targetName || 'Invitation'}</p>
                  <p className="invite-meta">
                    {tab === 'received'
                      ? `from @${invitation.inviter?.username || 'a player'}`
                      : `to a player · ${invitation.status}`}
                    {invitation.expiresAt && (
                      <span className="invite-expiry">
                        <ClockIcon size={12} /> expires {dateLabel(invitation.expiresAt)}
                      </span>
                    )}
                  </p>
                  {invitation.message && <p className="invite-message">{invitation.message}</p>}
                </div>
                {tab === 'received' && invitation.status === 'pending' && (
                  <span className="invite-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={Boolean(busy)}
                      onClick={() => respond(invitation, 'accept')}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={Boolean(busy)}
                      onClick={() => respond(invitation, 'decline')}
                    >
                      Decline
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default InvitationInbox;
