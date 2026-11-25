import React, { useCallback, useEffect, useState } from 'react';
import axiosInstance from '../../api/axiosInstance';
import SegmentedTabs from '../common/SegmentedTabs';
import ConfirmModal from '../common/ConfirmModal';

/**
 * Admin console panels.
 *
 * Each panel owns its own loading, error and paging state so a slow users list
 * never blocks the moderation queue. Every destructive control asks for the
 * reason the server requires, and the server remains the authority: the client
 * never decides who may be suspended or which content is hidden.
 */

const time = (value) => (value ? new Date(value).toLocaleString() : '—');

const failure = (err) =>
  err.response?.data?.message ||
  (err.response ? `Request failed (HTTP ${err.response.status}).` : 'The API did not answer.');

const Panel = ({ title, badge, children, toolbar }) => (
  <section className="admin-card admin-panel">
    <div className="admin-card-head">
      <h2>{title}</h2>
      {badge !== undefined && badge !== null && <span className="admin-badge muted">{badge}</span>}
    </div>
    {toolbar}
    {children}
  </section>
);

const Toolbar = ({ children }) => <div className="admin-panel-toolbar">{children}</div>;

const LoadMore = ({ show, busy, onClick }) =>
  show ? (
    <div className="admin-panel-more">
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onClick}>
        {busy ? 'Loading…' : 'Load more'}
      </button>
    </div>
  ) : null;

const STATUS_OPTIONS = [
  'active',
  'restricted',
  'frozen',
  'suspended',
  'deletion_pending',
  'deleted',
];
const ROLE_OPTIONS = ['user', 'moderator', 'admin'];

// ─── Users ───────────────────────────────────────────────────────────────────

export const UsersPanel = () => {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [verified, setVerified] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [before, setBefore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [actionRole, setActionRole] = useState('user');
  const [actionStatus, setActionStatus] = useState('suspend');
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [pendingAction, setPendingAction] = useState(null);

  const load = useCallback(
    async ({ append = false } = {}) => {
      setLoading(!append);
      setBusy(append);
      setError('');
      try {
        const params = new URLSearchParams({ limit: '25' });
        if (q.trim()) params.set('q', q.trim());
        if (status) params.set('status', status);
        if (role) params.set('role', role);
        if (verified) params.set('verified', verified);
        if (append && before) params.set('before', before);
        const { data } = await axiosInstance.get(`/admin/users?${params.toString()}`);
        setItems((prev) => (append ? [...prev, ...(data.items || [])] : data.items || []));
        setBefore(data.nextBefore || null);
        setTotal(data.total || 0);
      } catch (err) {
        setError(failure(err));
      } finally {
        setLoading(false);
        setBusy(false);
      }
    },
    [q, status, role, verified, before],
  );

  useEffect(() => {
    load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const open = async (user) => {
    setSelected(user);
    setDetail(null);
    setActionRole(user.role);
    setActionStatus(user.status === 'active' ? 'suspend' : 'reinstate');
    setReason('');
    setUntil('');
    try {
      const { data } = await axiosInstance.get(`/admin/users/${user._id}`);
      setDetail(data);
    } catch (err) {
      setError(failure(err));
    }
  };

  const run = async (request, successMessage) => {
    setBusy(true);
    setError('');
    try {
      await request();
      if (successMessage) setError('');
      await load();
      if (selected) {
        const { data } = await axiosInstance.get(`/admin/users/${selected._id}`);
        setDetail(data);
      }
      return true;
    } catch (err) {
      setError(failure(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const applyRole = () => {
    if (!selected) return;
    setPendingAction('role');
  };

  const applyStatus = () => {
    if (!selected) return;
    setPendingAction('status');
  };

  const confirmRole = () => {
    setPendingAction(null);
    run(() => axiosInstance.patch(`/admin/users/${selected._id}/role`, { role: actionRole }));
  };

  const confirmStatus = () => {
    setPendingAction(null);
    run(() =>
      axiosInstance.patch(`/admin/users/${selected._id}/status`, {
        action: actionStatus,
        reason,
        ...(actionStatus === 'suspend' && until ? { until: new Date(until).toISOString() } : {}),
      }),
    );
  };

  return (
    <>
      <Panel
        title="Accounts"
        badge={`${total.toLocaleString()} matching`}
        toolbar={
          <Toolbar>
            <input
              className="form-input"
              placeholder="Username or email"
              aria-label="Search accounts"
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
            <select
              className="form-input"
              aria-label="Filter by status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Any status</option>
              {STATUS_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <select
              className="form-input"
              aria-label="Filter by role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="">Any role</option>
              {ROLE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <select
              className="form-input"
              aria-label="Filter by verification"
              value={verified}
              onChange={(e) => setVerified(e.target.value)}
            >
              <option value="">Any verification</option>
              <option value="yes">Verified</option>
              <option value="no">Unverified</option>
            </select>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => load()}
              disabled={loading}
            >
              Search
            </button>
          </Toolbar>
        }
      >
        {error && <p className="admin-warn">{error}</p>}
        {loading ? (
          <p className="admin-note">Loading accounts…</p>
        ) : items.length === 0 ? (
          <p className="admin-note">No accounts matched those filters.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Role</th>
                <th>Status</th>
                <th>Verified</th>
                <th>Joined</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((user) => (
                <tr key={user._id} className={selected?._id === user._id ? 'is-selected' : ''}>
                  <td>
                    <strong>@{user.username}</strong>
                    <div className="admin-report-note">{user.email}</div>
                  </td>
                  <td>{user.role}</td>
                  <td>
                    <span className={`admin-badge ${user.status === 'active' ? 'ok' : 'warn'}`}>
                      {user.status}
                    </span>
                  </td>
                  <td>{user.emailVerified ? 'yes' : 'no'}</td>
                  <td>{time(user.createdAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => open(user)}
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <LoadMore show={Boolean(before)} busy={busy} onClick={() => load({ append: true })} />
      </Panel>

      <ConfirmModal
        isOpen={pendingAction === 'role'}
        title="Change platform role?"
        message={selected ? `Change @${selected.username}'s role to ${actionRole}.` : ''}
        confirmText="Apply role"
        busy={busy}
        onCancel={() => setPendingAction(null)}
        onConfirm={confirmRole}
      />

      <ConfirmModal
        isOpen={pendingAction === 'status'}
        title={`${actionStatus[0].toUpperCase()}${actionStatus.slice(1)} account?`}
        message={
          selected
            ? `${actionStatus} @${selected.username}? Their live sessions will be revoked.`
            : ''
        }
        confirmText="Apply"
        isDanger={actionStatus !== 'reinstate'}
        busy={busy}
        onCancel={() => setPendingAction(null)}
        onConfirm={confirmStatus}
      />

      {selected && (
        <section className="admin-card admin-panel admin-detail">
          <div className="admin-card-head">
            <h2>@{selected.username}</h2>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setSelected(null);
                setDetail(null);
              }}
            >
              Close
            </button>
          </div>
          {!detail ? (
            <p className="admin-note">Loading account detail…</p>
          ) : (
            <>
              <div className="admin-stats">
                <div className="admin-stat">
                  <span className="admin-stat-label">Posts</span>
                  <span className="admin-stat-value">{detail.activity.posts}</span>
                </div>
                <div className="admin-stat">
                  <span className="admin-stat-label">Comments</span>
                  <span className="admin-stat-value">{detail.activity.comments}</span>
                </div>
                <div className="admin-stat">
                  <span className="admin-stat-label">Messages</span>
                  <span className="admin-stat-value">{detail.activity.messages}</span>
                </div>
                <div className="admin-stat">
                  <span className="admin-stat-label">Reports against</span>
                  <span className="admin-stat-value">
                    {detail.activity.reportsAgainst + detail.activity.dmReportsAgainst}
                  </span>
                </div>
              </div>

              {detail.user.moderation?.reason && (
                <p className="admin-warn">
                  Last moderation: {detail.user.moderation.reason} ·{' '}
                  {time(detail.user.moderation.at)}
                  {detail.user.moderation.until
                    ? ` · until ${time(detail.user.moderation.until)}`
                    : ''}
                </p>
              )}

              <div className="admin-detail-grid">
                <div className="admin-detail-block">
                  <h3 className="admin-subhead">Platform role</h3>
                  <div className="admin-inline-form">
                    <select
                      className="form-input"
                      aria-label="Platform role"
                      value={actionRole}
                      onChange={(e) => setActionRole(e.target.value)}
                    >
                      {ROLE_OPTIONS.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busy}
                      onClick={applyRole}
                    >
                      Apply role
                    </button>
                  </div>
                </div>

                <div className="admin-detail-block">
                  <h3 className="admin-subhead">Account state</h3>
                  <div className="admin-inline-form">
                    <select
                      className="form-input"
                      aria-label="Account action"
                      value={actionStatus}
                      onChange={(e) => setActionStatus(e.target.value)}
                    >
                      <option value="restrict">Restrict</option>
                      <option value="suspend">Suspend</option>
                      <option value="reinstate">Reinstate</option>
                    </select>
                    <input
                      className="form-input"
                      placeholder="Reason (required)"
                      aria-label="Reason"
                      value={reason}
                      maxLength={300}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    {actionStatus === 'suspend' && (
                      <input
                        className="form-input"
                        type="datetime-local"
                        aria-label="Suspension end"
                        value={until}
                        onChange={(e) => setUntil(e.target.value)}
                      />
                    )}
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busy}
                      onClick={applyStatus}
                    >
                      Apply
                    </button>
                  </div>
                </div>

                <div className="admin-detail-block">
                  <h3 className="admin-subhead">Sessions & email</h3>
                  <div className="admin-report-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() =>
                        run(() => axiosInstance.post(`/admin/users/${selected._id}/logout-all`))
                      }
                    >
                      Sign out everywhere
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy || detail.user.emailVerified}
                      onClick={() =>
                        run(() =>
                          axiosInstance.post(`/admin/users/${selected._id}/resend-verification`),
                        )
                      }
                    >
                      Resend verification
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          axiosInstance.post(`/admin/users/${selected._id}/send-password-reset`),
                        )
                      }
                    >
                      Send password reset
                    </button>
                  </div>
                </div>
              </div>

              {detail.audit?.length > 0 && (
                <>
                  <h3 className="admin-subhead">Recent audit</h3>
                  <ul className="audit-stream">
                    {detail.audit.map((entry) => (
                      <li key={entry._id} className="audit-row">
                        <span className="audit-action">{entry.actionType}</span>
                        <span className="audit-time">{time(entry.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
};

// ─── Moderation queue ────────────────────────────────────────────────────────

export const ModerationPanel = () => {
  const [status, setStatus] = useState('open');
  const [source, setSource] = useState('all');
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ dm: 0, community: 0 });
  const [before, setBefore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState({});

  const load = useCallback(
    async ({ append = false } = {}) => {
      setLoading(!append);
      setError('');
      try {
        const params = new URLSearchParams({ status, source, limit: '20' });
        if (append && before) params.set('before', before);
        const { data } = await axiosInstance.get(`/admin/cases?${params.toString()}`);
        setItems((prev) => (append ? [...prev, ...(data.items || [])] : data.items || []));
        setBefore(data.nextBefore || null);
        setCounts(data.counts || { dm: 0, community: 0 });
      } catch (err) {
        setError(failure(err));
      } finally {
        setLoading(false);
      }
    },
    [status, source, before],
  );

  useEffect(() => {
    load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [status, source]);

  const resolve = async (item, decision) => {
    const note = notes[`${item.source}:${item.id}`] || '';
    setBusy(`${item.source}:${item.id}`);
    setError('');
    try {
      await axiosInstance.post(`/admin/cases/${item.source}/${item.id}/resolve`, {
        decision,
        note,
      });
      setNotes((prev) => ({ ...prev, [`${item.source}:${item.id}`]: '' }));
      await load();
    } catch (err) {
      setError(failure(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      title="Moderation queue"
      badge={`${counts.dm + counts.community} open`}
      toolbar={
        <Toolbar>
          <select
            className="form-input"
            aria-label="Case status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="open">Open</option>
            <option value="reviewed">Reviewed</option>
            <option value="actioned">Actioned</option>
            <option value="dismissed">Dismissed</option>
          </select>
          <select
            className="form-input"
            aria-label="Case source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="all">All sources</option>
            <option value="dm">Direct messages</option>
            <option value="community">Servers</option>
          </select>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => load()}>
            Refresh
          </button>
        </Toolbar>
      }
    >
      {error && <p className="admin-warn">{error}</p>}
      {loading ? (
        <p className="admin-note">Loading the queue…</p>
      ) : items.length === 0 ? (
        <p className="admin-note">Nothing waiting in this queue.</p>
      ) : (
        <div className="admin-cases">
          {items.map((item) => {
            const key = `${item.source}:${item.id}`;
            return (
              <article key={key} className="admin-case">
                <div className="admin-case-head">
                  <span className={`admin-badge ${item.source === 'dm' ? 'warn' : 'muted'}`}>
                    {item.source === 'dm' ? 'Direct message' : 'Server'}
                  </span>
                  <span className="admin-case-reason">
                    {String(item.reason || '').replace(/_/g, ' ')}
                  </span>
                  <span className="admin-stat-hint">{time(item.createdAt)}</span>
                </div>
                <p className="admin-report-note">
                  Reporter <strong>@{item.reporter?.username || 'deleted'}</strong>
                  {item.reported?.username ? (
                    <>
                      {' '}
                      · reported <strong>@{item.reported.username}</strong>
                    </>
                  ) : null}
                  {item.community ? (
                    <>
                      {' '}
                      · in <strong>{item.community.name}</strong>
                    </>
                  ) : null}
                </p>
                {item.note && <p className="admin-report-note">{item.note}</p>}
                {item.preview?.map((preview, index) => (
                  <p key={index} className="admin-case-preview">
                    <span className="mono">{preview.kind}</span> {preview.text || '(no content)'}
                    {preview.deleted ? ' · already removed' : ''}
                  </p>
                ))}
                <div className="admin-case-actions">
                  <input
                    className="form-input"
                    placeholder="Decision note (required to suspend)"
                    aria-label={`Note for case ${item.id}`}
                    value={notes[key] || ''}
                    maxLength={500}
                    onChange={(event) =>
                      setNotes((prev) => ({ ...prev, [key]: event.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy === key}
                    onClick={() => resolve(item, 'dismiss')}
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy === key}
                    onClick={() => resolve(item, 'review')}
                  >
                    Mark reviewed
                  </button>
                  {item.source === 'community' && item.targetType !== 'member' && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busy === key}
                      onClick={() => resolve(item, 'remove_content')}
                    >
                      Remove content
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy === key}
                    onClick={() => resolve(item, 'suspend_author')}
                  >
                    Suspend author
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <LoadMore show={Boolean(before)} busy={loading} onClick={() => load({ append: true })} />
    </Panel>
  );
};

// ─── Content ─────────────────────────────────────────────────────────────────

const CONTENT_TYPES = [
  { key: 'posts', label: 'Posts' },
  { key: 'comments', label: 'Comments' },
  { key: 'messages', label: 'Messages' },
];

export const ContentPanel = () => {
  const [type, setType] = useState('posts');
  const [q, setQ] = useState('');
  const [visibility, setVisibility] = useState('');
  const [items, setItems] = useState([]);
  const [before, setBefore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [visibilityPrompt, setVisibilityPrompt] = useState(null);

  const load = useCallback(
    async ({ append = false } = {}) => {
      setLoading(!append);
      setError('');
      try {
        const params = new URLSearchParams({ limit: '20' });
        if (q.trim()) params.set('q', q.trim());
        if (visibility) params.set('visibility', visibility);
        if (append && before) params.set('before', before);
        const { data } = await axiosInstance.get(`/admin/content/${type}?${params.toString()}`);
        setItems((prev) => (append ? [...prev, ...(data.items || [])] : data.items || []));
        setBefore(data.nextBefore || null);
      } catch (err) {
        setError(failure(err));
      } finally {
        setLoading(false);
      }
    },
    [type, q, visibility, before],
  );

  useEffect(() => {
    setItems([]);
    setBefore(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, visibility]);

  const hiddenFor = (item) => (type === 'messages' ? item.isDeleted : Boolean(item.hiddenAt));

  const openVisibility = (item) => {
    setVisibilityPrompt({ item, reason: '' });
  };

  const applyVisibility = async () => {
    const pending = visibilityPrompt;
    const reason = pending?.reason.trim();
    if (!pending || !reason) return;
    const hidden = hiddenFor(pending.item);

    setVisibilityPrompt(null);
    setBusy(pending.item._id);
    setError('');
    try {
      await axiosInstance.patch(`/admin/content/${type}/${pending.item._id}/visibility`, {
        hidden: !hidden,
        reason,
      });
      await load();
    } catch (err) {
      setError(failure(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      title="Content"
      badge={`${items.length} loaded`}
      toolbar={
        <Toolbar>
          <SegmentedTabs
            ariaLabel="Content type"
            options={CONTENT_TYPES}
            value={type}
            onChange={setType}
            size="sm"
          />
          <input
            className="form-input"
            placeholder="Search text"
            aria-label="Search content"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') load();
            }}
          />
          <select
            className="form-input"
            aria-label="Visibility"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
          >
            <option value="">Any state</option>
            <option value="visible">Visible</option>
            <option value="hidden">Hidden</option>
          </select>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => load()}>
            Search
          </button>
        </Toolbar>
      }
    >
      {error && <p className="admin-warn">{error}</p>}
      {loading ? (
        <p className="admin-note">Loading content…</p>
      ) : items.length === 0 ? (
        <p className="admin-note">No content matched.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Content</th>
              <th>Author</th>
              <th>Where</th>
              <th>State</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item._id}>
                <td className="admin-report-note">{item.title || item.text || '(empty)'}</td>
                <td>@{item.author || 'deleted'}</td>
                <td>
                  {item.community?.name || item.postId || (item.tags || []).join(', ') || '—'}
                </td>
                <td>
                  <span className={`admin-badge ${hiddenFor(item) ? 'warn' : 'ok'}`}>
                    {hiddenFor(item) ? 'hidden' : 'visible'}
                  </span>
                </td>
                <td>{time(item.createdAt)}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy === item._id}
                    onClick={() => openVisibility(item)}
                  >
                    {hiddenFor(item) ? 'Restore' : 'Hide'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <LoadMore show={Boolean(before)} busy={loading} onClick={() => load({ append: true })} />

      <ConfirmModal
        isOpen={Boolean(visibilityPrompt)}
        title={
          visibilityPrompt && hiddenFor(visibilityPrompt.item)
            ? 'Restore content?'
            : 'Hide content?'
        }
        message="The reason is stored in the moderation audit trail."
        confirmText={visibilityPrompt && hiddenFor(visibilityPrompt.item) ? 'Restore' : 'Hide'}
        isDanger={Boolean(visibilityPrompt && !hiddenFor(visibilityPrompt.item))}
        busy={Boolean(visibilityPrompt && busy === visibilityPrompt.item._id)}
        confirmDisabled={!visibilityPrompt?.reason.trim()}
        onCancel={() => setVisibilityPrompt(null)}
        onConfirm={applyVisibility}
      >
        <label className="form-group" htmlFor="visibility-reason">
          <span className="form-label">Reason</span>
          <textarea
            id="visibility-reason"
            className="form-textarea"
            value={visibilityPrompt?.reason || ''}
            maxLength={300}
            onChange={(event) =>
              setVisibilityPrompt((current) =>
                current ? { ...current, reason: event.target.value } : current,
              )
            }
            autoFocus
          />
        </label>
      </ConfirmModal>
    </Panel>
  );
};

// ─── Catalog ─────────────────────────────────────────────────────────────────

export const CatalogPanel = () => {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({});
  const [total, setTotal] = useState(0);
  const [before, setBefore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [mergePrompt, setMergePrompt] = useState(null);

  const load = useCallback(
    async ({ append = false } = {}) => {
      setLoading(!append);
      setError('');
      try {
        const params = new URLSearchParams({ limit: '25' });
        if (q.trim()) params.set('q', q.trim());
        if (status) params.set('status', status);
        if (append && before) params.set('before', before);
        const { data } = await axiosInstance.get(`/admin/games?${params.toString()}`);
        setItems((prev) => (append ? [...prev, ...(data.items || [])] : data.items || []));
        setBefore(data.nextBefore || null);
        setCounts(data.counts || {});
        setTotal(data.total || 0);
      } catch (err) {
        setError(failure(err));
      } finally {
        setLoading(false);
      }
    },
    [q, status, before],
  );

  useEffect(() => {
    load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const sync = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { data } = await axiosInstance.post('/admin/games/sync', { provider: 'freetogame' });
      setMessage(`Synced ${data.synced} FreeToGame titles (${data.inserted || 0} new).`);
      await load();
    } catch (err) {
      setError(failure(err));
    } finally {
      setBusy(false);
    }
  };

  const setGameStatus = async (game, nextStatus) => {
    setBusy(true);
    setError('');
    try {
      await axiosInstance.patch(`/admin/games/${game._id}`, { status: nextStatus });
      await load();
    } catch (err) {
      setError(failure(err));
    } finally {
      setBusy(false);
    }
  };

  const openMerge = (game) => setMergePrompt({ game, intoId: '' });

  const applyMerge = async () => {
    const pending = mergePrompt;
    const intoId = pending?.intoId.trim();
    if (!pending || !intoId) return;

    setMergePrompt(null);
    setBusy(true);
    setError('');
    try {
      await axiosInstance.post(`/admin/games/${pending.game._id}/merge`, { intoId });
      await load();
    } catch (err) {
      setError(failure(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Game catalog"
      badge={`${total.toLocaleString()} games`}
      toolbar={
        <Toolbar>
          <input
            className="form-input"
            placeholder="Search titles"
            aria-label="Search catalog"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') load();
            }}
          />
          <select
            className="form-input"
            aria-label="Catalog status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Any status</option>
            <option value="published">Published</option>
            <option value="provisional">Provisional</option>
            <option value="hidden">Hidden</option>
            <option value="merged">Merged</option>
          </select>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => load()}>
            Search
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={sync}>
            {busy ? 'Working…' : 'Sync FreeToGame'}
          </button>
        </Toolbar>
      }
    >
      {message && <p className="admin-note">{message}</p>}
      {error && <p className="admin-warn">{error}</p>}
      <p className="admin-note">
        {Object.entries(counts)
          .map(([key, value]) => `${key}: ${value}`)
          .join(' · ') || 'No catalog rows yet.'}
      </p>
      {loading ? (
        <p className="admin-note">Loading catalog…</p>
      ) : items.length === 0 ? (
        <p className="admin-note">No games matched.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Game</th>
              <th>Genre</th>
              <th>Followers</th>
              <th>Status</th>
              <th>Id</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((game) => (
              <tr key={game._id}>
                <td>
                  <strong>{game.title}</strong>
                  <div className="admin-report-note mono">{game.slug}</div>
                </td>
                <td>{(game.genres || []).slice(0, 2).join(', ') || '—'}</td>
                <td>{game.stats?.favoriteCount || 0}</td>
                <td>
                  <span className={`admin-badge ${game.status === 'published' ? 'ok' : 'warn'}`}>
                    {game.status}
                  </span>
                </td>
                <td className="mono">{String(game._id).slice(-8)}</td>
                <td>
                  <div className="admin-report-actions">
                    {game.status !== 'hidden' ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => setGameStatus(game, 'hidden')}
                      >
                        Hide
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => setGameStatus(game, 'published')}
                      >
                        Publish
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => openMerge(game)}
                    >
                      Merge
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <LoadMore show={Boolean(before)} busy={loading} onClick={() => load({ append: true })} />

      <ConfirmModal
        isOpen={Boolean(mergePrompt)}
        title="Merge duplicate game"
        message={
          mergePrompt
            ? `Merge "${mergePrompt.game.title}" into another catalog row. The target id survives; this row becomes an alias.`
            : ''
        }
        confirmText="Merge game"
        isDanger
        busy={busy}
        confirmDisabled={!mergePrompt?.intoId.trim()}
        onCancel={() => setMergePrompt(null)}
        onConfirm={applyMerge}
      >
        <label className="form-group" htmlFor="merge-target-id">
          <span className="form-label">Surviving game id</span>
          <input
            id="merge-target-id"
            className="form-input"
            value={mergePrompt?.intoId || ''}
            maxLength={80}
            onChange={(event) =>
              setMergePrompt((current) =>
                current ? { ...current, intoId: event.target.value } : current,
              )
            }
            autoFocus
          />
        </label>
      </ConfirmModal>
    </Panel>
  );
};

// ─── Audit ───────────────────────────────────────────────────────────────────

export const AuditPanel = () => {
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [items, setItems] = useState([]);
  const [before, setBefore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(
    async ({ append = false } = {}) => {
      setLoading(!append);
      setError('');
      try {
        const params = new URLSearchParams({ limit: '30' });
        if (action.trim()) params.set('action', action.trim().toUpperCase());
        if (actor.trim()) params.set('actor', actor.trim());
        if (from) params.set('from', new Date(from).toISOString());
        if (to) params.set('to', new Date(to).toISOString());
        if (append && before) params.set('before', before);
        const { data } = await axiosInstance.get(`/admin/audit?${params.toString()}`);
        setItems((prev) => (append ? [...prev, ...(data.items || [])] : data.items || []));
        setBefore(data.nextBefore || null);
      } catch (err) {
        setError(failure(err));
      } finally {
        setLoading(false);
      }
    },
    [action, actor, from, to, before],
  );

  useEffect(() => {
    load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  return (
    <Panel
      title="Audit log"
      badge={`${items.length} loaded`}
      toolbar={
        <Toolbar>
          <input
            className="form-input"
            placeholder="Action (e.g. PLATFORM_STATUS_UPDATE)"
            aria-label="Filter by action"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          />
          <input
            className="form-input"
            placeholder="Actor username"
            aria-label="Filter by actor"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
          />
          <input
            className="form-input"
            type="date"
            aria-label="From date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <input
            className="form-input"
            type="date"
            aria-label="To date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={() => load()}>
            Filter
          </button>
        </Toolbar>
      }
    >
      {error && <p className="admin-warn">{error}</p>}
      {loading ? (
        <p className="admin-note">Loading audit entries…</p>
      ) : items.length === 0 ? (
        <p className="admin-note">No audit entries matched.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Actor</th>
              <th>Scope</th>
              <th>Target</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {items.map((entry) => (
              <tr key={entry._id}>
                <td className="mono">{entry.actionType}</td>
                <td>
                  @{entry.actor}
                  {entry.actorRole ? ` (${entry.actorRole})` : ''}
                </td>
                <td>{entry.community || 'platform'}</td>
                <td className="mono">
                  {entry.targetModel || '—'}
                  {entry.targetId ? ` · ${entry.targetId.slice(-6)}` : ''}
                </td>
                <td>{time(entry.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <LoadMore show={Boolean(before)} busy={loading} onClick={() => load({ append: true })} />
    </Panel>
  );
};

// ─── Storage ────────────────────────────────────────────────────────────────

const formatBytes = (value) => {
  let bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let unit = 0;
  bytes /= 1024;
  while (bytes >= 1024 && unit < units.length - 1) {
    bytes /= 1024;
    unit += 1;
  }
  return `${bytes < 10 ? bytes.toFixed(1) : Math.round(bytes)} ${units[unit]}`;
};

const LedgerStat = ({ label, value, hint }) => (
  <div className="admin-stat">
    <span className="admin-stat-label">{label}</span>
    <span className="admin-stat-value">{value}</span>
    {hint && <span className="admin-stat-hint">{hint}</span>}
  </div>
);

const SURFACE_LABELS = {
  post: 'Posts',
  chat: 'Chat',
  avatar: 'Avatars',
  game: 'Game media',
  other: 'Other',
};

export const StoragePanel = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: payload } = await axiosInstance.get('/admin/storage');
      setData(payload);
    } catch (err) {
      setError(failure(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totals = data?.totals || { assets: 0, bytes: 0 };
  const rows = data?.bySurface || [];
  const statuses = data?.byStatus || {};

  return (
    <Panel
      title="Media ledger"
      badge={`${totals.assets} asset${totals.assets === 1 ? '' : 's'}`}
      toolbar={
        <Toolbar>
          <button type="button" className="btn btn-ghost btn-sm" disabled={loading} onClick={load}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </Toolbar>
      }
    >
      {error && <p className="admin-warn">{error}</p>}

      <div className="admin-stats">
        <LedgerStat label="Total assets" value={totals.assets} hint="ledger rows" />
        <LedgerStat
          label="Stored size"
          value={formatBytes(totals.bytes)}
          hint="across every surface"
        />
        <LedgerStat label="Ready" value={statuses.ready || 0} hint="deliverable" />
        <LedgerStat label="Pending" value={statuses.pending || 0} hint="awaiting validation" />
      </div>

      {loading && !data ? (
        <p className="admin-note">Loading the media ledger…</p>
      ) : rows.length === 0 ? (
        <p className="admin-note">No media has been recorded yet.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Surface</th>
              <th>Assets</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.surface}>
                <td>{SURFACE_LABELS[row.surface] || row.surface}</td>
                <td>{row.count}</td>
                <td className="mono">{formatBytes(row.bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="admin-note">
        Totals come from the upload ledger. The panel never lists file contents or delivery URLs.
      </p>
    </Panel>
  );
};

const AdminPanels = ({ tab }) => {
  if (tab === 'users') return <UsersPanel />;
  if (tab === 'moderation') return <ModerationPanel />;
  if (tab === 'content') return <ContentPanel />;
  if (tab === 'catalog') return <CatalogPanel />;
  if (tab === 'audit') return <AuditPanel />;
  if (tab === 'storage') return <StoragePanel />;
  return null;
};

export default AdminPanels;
