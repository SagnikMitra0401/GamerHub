import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate } from 'react-router-dom';
import axiosInstance from '../../api/axiosInstance';
import { AlertIcon, CloseIcon } from '../common/icons';

const EXPIRY_OPTIONS = [
  { value: 0, label: 'Never expires' },
  { value: 1, label: '1 day' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' }
];

const USE_OPTIONS = [
  { value: 0, label: 'No use limit' },
  { value: 1, label: '1 use' },
  { value: 5, label: '5 uses' },
  { value: 25, label: '25 uses' },
  { value: 100, label: '100 uses' }
];

const formatDate = (value) => value ? new Date(value).toLocaleDateString() : null;

const InviteModal = ({ isOpen, onClose, community, onNotice }) => {
  const navigate = useNavigate();
  const [invites, setInvites] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ expiresInDays: 7, maxUses: 0, requiresApproval: false });
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    if (!isOpen || !community?._id) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    // Private servers default to reviewing requests; public ones to instant join.
    setForm(prev => ({ ...prev, requiresApproval: !!community.isPrivate }));

    Promise.all([
      axiosInstance.get(`/communities/${community._id}/invites`),
      axiosInstance.get(`/communities/${community._id}/join-requests`)
    ])
      .then(([inviteRes, requestRes]) => {
        if (cancelled) return;
        setInvites(Array.isArray(inviteRes.data.items) ? inviteRes.data.items : []);
        setRequests(Array.isArray(requestRes.data.items) ? requestRes.data.items : []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.message || 'Could not load invite links.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [isOpen, community?._id, community?.isPrivate]);

  if (!isOpen || !community) return null;

  // The server builds the URL from CLIENT_URL so links copied from a preview
  // still point at the deployed app; this is only a last-resort fallback.
  const linkFor = (invite) => invite.url || `${window.location.origin}/join/${invite.code}`;

  const copy = async (invite) => {
    try {
      await navigator.clipboard.writeText(linkFor(invite));
      setCopied(invite.code);
      setTimeout(() => setCopied(''), 2000);
    } catch {
      setError('Could not copy automatically — select the link and copy it manually.');
    }
  };

  const create = async (event) => {
    event.preventDefault();
    setCreating(true);
    setError('');
    try {
      const { data } = await axiosInstance.post(`/communities/${community._id}/invites`, form);
      setInvites(prev => [data.invite, ...prev]);
      onNotice?.(form.requiresApproval
        ? 'Invite link ready — requests will wait for your approval.'
        : 'Invite link ready — copy it or share it in a post.');
      await copy(data.invite);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not create an invite link.');
    } finally {
      setCreating(false);
    }
  };

  const refreshInvites = async () => {
    try {
      const { data } = await axiosInstance.get(`/communities/${community._id}/invites`);
      setInvites(Array.isArray(data.items) ? data.items : []);
    } catch {
      /* the decision already succeeded; the list refreshes on reopen */
    }
  };

  const revoke = async (invite) => {
    if (!window.confirm('Revoke this invite link? People who already joined stay in the server.')) return;
    setBusyId(invite._id);
    setError('');
    try {
      await axiosInstance.delete(`/communities/${community._id}/invites/${invite._id}`);
      setInvites(prev => prev.filter(entry => entry._id !== invite._id));
      setRequests(prev => prev.filter(entry => entry.code !== invite.code));
      onNotice?.('Invite link revoked.');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not revoke that link.');
    } finally {
      setBusyId('');
    }
  };

  const decide = async (request, decision) => {
    setBusyId(request._id);
    setError('');
    try {
      await axiosInstance.post(
        `/communities/${community._id}/join-requests/${request._id}/${decision}`
      );
      setRequests(prev => prev.filter(entry => entry._id !== request._id));
      await refreshInvites();
      onNotice?.(decision === 'approve'
        ? `${request.username} joined the server.`
        : `${request.username}'s request was declined.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update that request.');
    } finally {
      setBusyId('');
    }
  };

  const shareInPost = (invite) => {
    const draft = `Join ${community.name} on Gaming Hub — ${linkFor(invite)}`;
    onClose?.();
    navigate(`/?create=1&draft=${encodeURIComponent(draft)}`);
  };

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="invite-title">
      <div className="modal-box" onClick={event => event.stopPropagation()} style={{ maxWidth: '580px' }}>
        <div className="modal-header-row">
          <h2 id="invite-title" className="modal-title" style={{ margin: 0 }}>
            Invite people to {community.name}
          </h2>
          <button onClick={onClose} className="modal-close" aria-label="Close"><CloseIcon size={16} /></button>
        </div>

        <p className="text-muted" style={{ fontSize: '0.8rem', lineHeight: 1.55 }}>
          {community.isPrivate
            ? 'This server is invite-only. Only people with a link you create here can join — share it directly with a friend or paste it into a post.'
            : 'This server is public, so the link is a shortcut that brings the person straight into the chat.'}
          {' '}Links always join as a member; they never grant moderator or admin powers.
        </p>

        {error && (
          <p className="dm-inline-error" role="alert" style={{ marginBottom: '0.75rem' }}>
            <AlertIcon size={13} /> {error}
          </p>
        )}

        <form onSubmit={create}>
          <div className="form-grid-2" style={{ alignItems: 'end' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="invite-expiry">Link expires</label>
              <select
                id="invite-expiry"
                className="form-input"
                value={form.expiresInDays}
                onChange={event => setForm(prev => ({ ...prev, expiresInDays: Number(event.target.value) }))}
              >
                {EXPIRY_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="invite-uses">Uses</label>
              <select
                id="invite-uses"
                className="form-input"
                value={form.maxUses}
                onChange={event => setForm(prev => ({ ...prev, maxUses: Number(event.target.value) }))}
              >
                {USE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.requiresApproval}
              onChange={event => setForm(prev => ({ ...prev, requiresApproval: event.target.checked }))}
            />
            Require my approval before someone joins
          </label>
          <span className="text-muted" style={{ display: 'block', fontSize: '0.72rem', margin: '0.15rem 0 0.75rem' }}>
            Requests appear below. Approval consumes one use, so the link cannot let in more people than its limit.
          </span>

          <button className="btn btn-primary btn-sm" disabled={creating}>
            {creating ? 'Creating…' : 'Create invite link'}
          </button>
        </form>

        <div style={{ marginTop: '1.25rem' }}>
          <h3 style={{ fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
            Join requests{requests.length > 0 ? ` (${requests.length})` : ''}
          </h3>

          {loading ? (
            <p className="text-muted" style={{ fontSize: '0.8rem' }}>Loading…</p>
          ) : requests.length === 0 ? (
            <p className="text-muted" style={{ fontSize: '0.8rem' }}>
              No one is waiting for approval.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {requests.map(request => (
                <li
                  key={request._id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '0.6rem 0.75rem',
                    background: 'var(--bg-surface)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.6rem',
                    flexWrap: 'wrap'
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: '0.85rem' }}>{request.username}</strong>
                    <div className="text-muted" style={{ fontSize: '0.7rem' }}>
                      requested via link {request.code || 'unknown'} · {new Date(request.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => decide(request, 'approve')}
                      disabled={busyId === request._id}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => decide(request, 'deny')}
                      disabled={busyId === request._id}
                    >
                      Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ marginTop: '1.25rem' }}>
          <h3 style={{ fontSize: '0.85rem', margin: '0 0 0.5rem' }}>Active links</h3>

          {loading ? (
            <p className="text-muted" style={{ fontSize: '0.8rem' }}>Loading links…</p>
          ) : invites.length === 0 ? (
            <p className="text-muted" style={{ fontSize: '0.8rem' }}>
              No links yet. Create one above and share it anywhere.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {invites.map(invite => {
                const remaining = invite.maxUses > 0 ? Math.max(0, invite.maxUses - invite.uses) : null;
                const expires = formatDate(invite.expiresAt);
                return (
                  <li
                    key={invite._id}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      padding: '0.65rem 0.75rem',
                      background: 'var(--bg-surface)'
                    }}
                  >
                    <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                      <input
                        className="form-input"
                        value={linkFor(invite)}
                        readOnly
                        aria-label={`Invite link ${invite.code}`}
                        onFocus={event => event.target.select()}
                        style={{ flex: '1 1 220px', fontSize: '0.78rem' }}
                      />
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(invite)}>
                        {copied === invite.code ? 'Copied' : 'Copy'}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => shareInPost(invite)}>
                        Share in post
                      </button>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', marginTop: '0.45rem', flexWrap: 'wrap' }}>
                      <span className="text-muted" style={{ fontSize: '0.7rem' }}>
                        {remaining === null ? `${invite.uses} uses · no limit` : `${invite.uses}/${invite.maxUses} uses`}
                        {' · '}
                        {expires ? `expires ${expires}` : 'never expires'}
                        {invite.requiresApproval ? ' · approval required' : ''}
                        {invite.status && invite.status !== 'active' ? ` · ${invite.status.replace('_', ' ')}` : ''}
                      </span>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => revoke(invite)}
                        disabled={busyId === invite._id}
                      >
                        {busyId === invite._id ? 'Revoking…' : 'Revoke'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default InviteModal;
