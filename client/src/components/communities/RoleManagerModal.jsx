import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import axiosInstance from '../../api/axiosInstance';
import ConfirmModal from '../common/ConfirmModal';
import {
  CAP,
  ROLE_LABELS,
  ROLE_COLORS,
  assignableRoles,
  hasCapability
} from '../../utils/permissions';

/**
 * Server member administration.
 * Only the maintenance roles exist here: owner / admin / moderator / member.
 * These roles grant power inside this server only — never application-wide.
 */
const RoleManagerModal = ({ isOpen, onClose, community, callerRole, permissions = [], onChanged }) => {
  const [members, setMembers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [pendingKick, setPendingKick] = useState(null);

  const [addUsername, setAddUsername] = useState('');
  const [addRole, setAddRole] = useState('member');
  const [adding, setAdding] = useState(false);

  const canManageRoles = hasCapability(permissions, CAP.MANAGE_ROLES);
  const canKick        = hasCapability(permissions, CAP.KICK_MEMBERS);
  const canAdd         = hasCapability(permissions, CAP.ADD_MEMBERS);
  const grantable      = assignableRoles(callerRole);

  const load = useCallback(async () => {
    if (!community?._id) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (query.trim()) params.set('q', query.trim());
      const { data } = await axiosInstance.get(`/communities/${community._id}/members?${params}`);
      setMembers(data.members || []);
      setTotal(data.total ?? (data.members || []).length);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load members.');
    } finally {
      setLoading(false);
    }
  }, [community?._id, query]);

  useEffect(() => {
    if (!isOpen) return undefined;
    setError('');
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [isOpen, load]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setAddUsername('');
      setAddRole('member');
    }
  }, [isOpen, community?._id]);

  if (!isOpen || !community) return null;

  const changeRole = async (member, newRole) => {
    setBusyId(member.userId);
    setError('');
    try {
      await axiosInstance.patch(`/communities/${community._id}/members/${member.userId}/role`, { newRole });
      setMembers(prev => prev.map(m => (m.userId === member.userId ? { ...m, role: newRole } : m)));
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update that role.');
    } finally {
      setBusyId(null);
    }
  };

  const kick = async () => {
    if (!pendingKick) return;
    setBusyId(pendingKick.userId);
    setError('');
    try {
      await axiosInstance.delete(`/communities/${community._id}/members/${pendingKick.userId}`);
      setMembers(prev => prev.filter(m => m.userId !== pendingKick.userId));
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not remove that member.');
    } finally {
      setBusyId(null);
      setPendingKick(null);
    }
  };

  const addMember = async (e) => {
    e.preventDefault();
    if (!addUsername.trim()) return;
    setAdding(true);
    setError('');
    try {
      await axiosInstance.post(`/communities/${community._id}/members`, {
        username: addUsername.trim(),
        role: addRole
      });
      setAddUsername('');
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not add that member.');
    } finally {
      setAdding(false);
    }
  };

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="role-manager-title">
      <div className="modal-box role-manager-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header-row">
          <div>
            <h2 id="role-manager-title" className="modal-title" style={{ margin: 0 }}>🛡️ Members &amp; Roles</h2>
            <p className="text-muted" style={{ fontSize: '0.78rem', margin: '0.2rem 0 0' }}>
              Server roles only control this server. Application roles are separate.
            </p>
          </div>
          <button onClick={onClose} className="modal-close" aria-label="Close">✕</button>
        </div>

        {error && <div className="form-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}

        {canAdd && (
          <form onSubmit={addMember} className="role-add-form">
            <input
              className="form-input"
              placeholder="Add member by username…"
              value={addUsername}
              onChange={e => setAddUsername(e.target.value)}
              maxLength={20}
              aria-label="Username to add"
            />
            <select
              className="form-input"
              value={addRole}
              onChange={e => setAddRole(e.target.value)}
              aria-label="Role for new member"
            >
              {['member', 'moderator', ...(callerRole === 'owner' ? ['admin'] : [])].map(role => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </select>
            <button className="btn btn-primary btn-sm" disabled={adding || !addUsername.trim()}>
              {adding ? 'Adding…' : 'Add'}
            </button>
          </form>
        )}

        <input
          className="form-input"
          placeholder="🔍 Filter members…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          maxLength={40}
          style={{ marginBottom: '0.6rem' }}
          aria-label="Filter members"
        />

        <div className="role-member-list">
          {loading && <div className="spinner" />}

          {!loading && members.length === 0 && (
            <p className="text-muted" style={{ textAlign: 'center', padding: '1.5rem 0' }}>
              No members found.
            </p>
          )}

          {!loading && members.map(member => {
            const isOwner = member.role === 'owner';
            return (
              <div key={member.userId} className="role-member-row">
                <div className="member-avatar">{String(member.username || '?')[0].toUpperCase()}</div>

                <div className="role-member-info">
                  <span className="role-member-name">{member.username}</span>
                  <span className="role-member-meta" style={{ color: ROLE_COLORS[member.role] }}>
                    {ROLE_LABELS[member.role] || member.role}
                  </span>
                </div>

                {canManageRoles && !isOwner && grantable.length > 0 ? (
                  <select
                    className="form-input role-select"
                    value={member.role}
                    disabled={busyId === member.userId}
                    onChange={e => changeRole(member, e.target.value)}
                    aria-label={`Role for ${member.username}`}
                  >
                    {[member.role, ...grantable.filter(r => r !== member.role)].map(role => (
                      <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                    ))}
                  </select>
                ) : (
                  <span className="role-member-locked">{isOwner ? '👑' : '—'}</span>
                )}

                {canKick && !isOwner && (
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    disabled={busyId === member.userId}
                    onClick={() => setPendingKick(member)}
                    title="Remove from server"
                  >
                    Kick
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-muted" style={{ fontSize: '0.72rem', margin: '0.75rem 0 0' }}>
          Showing {members.length} of {total} member{total === 1 ? '' : 's'}
          {total > 100 ? ' — filter to find someone specific.' : '.'}
        </p>

        <ConfirmModal
          isOpen={!!pendingKick}
          title="Remove member"
          message={pendingKick
            ? `Remove ${pendingKick.username} from this server? They can rejoin public servers unless you make this server private.`
            : ''}
          confirmText="Remove"
          isDanger
          onConfirm={kick}
          onCancel={() => setPendingKick(null)}
        />
      </div>
    </div>,
    document.body
  );
};

export default RoleManagerModal;
