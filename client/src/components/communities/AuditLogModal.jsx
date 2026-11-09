import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import axiosInstance from '../../api/axiosInstance';
import { CloseIcon, ArrowRightIcon } from '../common/icons';

const ACTION_META = {
  ROLE_UPDATE:     { label: 'Role changed' },
  MEMBER_ADD:      { label: 'Member added' },
  MEMBER_KICK:     { label: 'Member removed' },
  CHANNEL_CREATE:  { label: 'Channel created' },
  CHANNEL_UPDATE:  { label: 'Channel updated' },
  CHANNEL_DELETE:  { label: 'Channel deleted' },
  MESSAGE_PURGE:   { label: 'Message purged' },
  SETTINGS_UPDATE: { label: 'Server settings changed' },
  INVITE_CREATE:   { label: 'Invite link created' },
  INVITE_REVOKE:   { label: 'Invite link revoked' },
  INVITE_JOIN:     { label: 'Joined via invite link' },
  INVITE_REQUEST:  { label: 'Requested to join via invite' },
  INVITE_APPROVE:  { label: 'Join request approved' },
  INVITE_DENY:     { label: 'Join request declined' }
};

const describe = (entry) => {
  const meta = entry.metadata || {};
  switch (entry.actionType) {
    case 'ROLE_UPDATE':
      return (
        <span className="audit-role-change">
          {meta.previousRole || 'member'}
          <ArrowRightIcon size={12} />
          {meta.newRole || 'member'}
        </span>
      );
    case 'MEMBER_ADD':
      return `${meta.username || 'user'} as ${meta.role || 'member'}`;
    case 'MEMBER_KICK':
      return `role: ${meta.role || 'member'}`;
    case 'CHANNEL_CREATE':
    case 'CHANNEL_DELETE':
      return meta.name ? `#${meta.name}` : '';
    case 'CHANNEL_UPDATE':
      return Array.isArray(meta.fields) ? meta.fields.join(', ') : '';
    case 'SETTINGS_UPDATE':
      return Array.isArray(meta.changes) ? meta.changes.join(', ') : '';
    case 'MESSAGE_PURGE':
      return meta.channelId ? `channel ${String(meta.channelId).slice(-6)}` : '';
    case 'INVITE_CREATE':
      return `link ${meta.code || '—'}${meta.requiresApproval ? ' · approval required' : ' · instant join'}`;
    case 'INVITE_REVOKE':
      return meta.code ? `link ${meta.code}` : '';
    case 'INVITE_JOIN':
      return `${meta.username || 'member'} · link ${meta.code || '—'}`;
    case 'INVITE_REQUEST':
    case 'INVITE_APPROVE':
    case 'INVITE_DENY':
      return `${meta.username || 'someone'}${meta.code ? ` · link ${meta.code}` : ''}`;
    default:
      return '';
  }
};

const timeAgo = (value) => {
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(value).toLocaleString();
};

const AuditLogModal = ({ isOpen, onClose, communityId }) => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  // "Invites" narrows the log to who created links and who joined through them.
  const [scope, setScope] = useState('');

  const load = useCallback(async (before = null) => {
    if (!communityId) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (before) params.set('before', before);
      if (scope) params.set('scope', scope);
      const { data } = await axiosInstance.get(`/communities/${communityId}/audit?${params}`);
      setEntries(prev => (before ? [...prev, ...(data.entries || [])] : (data.entries || [])));
      setHasMore(!!data.hasMore);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load the audit log.');
    } finally {
      setLoading(false);
    }
  }, [communityId, scope]);

  useEffect(() => {
    if (isOpen) {
      setEntries([]);
      setHasMore(false);
      load();
    }
  }, [isOpen, load]);

  if (!isOpen) return null;

  const loadOlder = () => {
    const oldest = entries[entries.length - 1];
    if (oldest?._id) load(oldest._id);
  };

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="audit-title">
      <div className="modal-box audit-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header-row">
          <div>
            <h2 id="audit-title" className="modal-title" style={{ margin: 0 }}>Audit Log</h2>
            <p className="text-muted" style={{ fontSize: '0.78rem', margin: '0.2rem 0 0' }}>
              Every administrative action in this server, newest first.
            </p>
          </div>
          <button onClick={onClose} className="modal-close" aria-label="Close"><CloseIcon size={16} /></button>
        </div>

        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem' }}>
          <button
            type="button"
            className={`btn btn-sm ${scope ? 'btn-ghost' : 'btn-primary'}`}
            onClick={() => setScope('')}
          >
            All activity
          </button>
          <button
            type="button"
            className={`btn btn-sm ${scope ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setScope('invites')}
          >
            Invites
          </button>
        </div>

        {error && <div className="form-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}

        <div className="audit-list">
          {loading && entries.length === 0 && <div className="spinner" />}

          {!loading && entries.length === 0 && !error && (
            <p className="text-muted" style={{ textAlign: 'center', padding: '1.5rem 0' }}>
              Nothing logged yet.
            </p>
          )}

          {entries.map(entry => {
            const meta = ACTION_META[entry.actionType] || { label: entry.actionType };
            const detail = describe(entry);
            return (
              <div key={entry._id} className="audit-entry">
                <div className="audit-body">
                  <div className="audit-line">
                    <strong>{entry.actorId?.username || 'Unknown'}</strong>
                    <span className="text-muted"> · {meta.label}</span>
                  </div>
                  {detail && <div className="audit-detail">{detail}</div>}
                  <div className="audit-time">{timeAgo(entry.createdAt)}</div>
                </div>
              </div>
            );
          })}
        </div>

        {hasMore && (
          <div style={{ textAlign: 'center', marginTop: '0.75rem' }}>
            <button className="btn btn-ghost btn-sm" onClick={loadOlder} disabled={loading}>
              {loading ? 'Loading…' : 'Load older'}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default AuditLogModal;
