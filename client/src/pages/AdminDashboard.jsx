import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';
import { AdminSkeleton } from '../components/common/Skeleton';
import SegmentedTabs from '../components/common/SegmentedTabs';
import AdminPanels from '../components/admin/AdminPanels';

const ADMIN_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users' },
  { key: 'moderation', label: 'Moderation' },
  { key: 'content', label: 'Content' },
  { key: 'catalog', label: 'Catalog' },
  { key: 'audit', label: 'Audit' },
  { key: 'storage', label: 'Storage' }
];
const STAFF_TABS = ['moderation', 'content', 'audit'];

const tabsForRole = (role) => (
  role === 'admin' ? ADMIN_TABS : ADMIN_TABS.filter((entry) => STAFF_TABS.includes(entry.key))
);

const formatUptime = (seconds) => {
  if (!Number.isFinite(seconds)) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${mins}m`;
  return `${mins}m`;
};

const formatTime = (value) => (value ? new Date(value).toLocaleString() : '—');

const Stat = ({ label, value, hint }) => (
  <div className="admin-stat">
    <span className="admin-stat-label">{label}</span>
    <span className="admin-stat-value">{value}</span>
    {hint && <span className="admin-stat-hint">{hint}</span>}
  </div>
);

/**
 * Turn an axios failure into an actionable sentence. "Could not load system
 * health" alone is a dead end: the usual causes are a stopped backend, an old
 * build without /api/admin, or a signed-out session.
 */
function describeFailure(err) {
  const status = err.response?.status;
  const serverMessage = err.response?.data?.message;

  if (status === 404) {
    return 'This backend build does not expose /api/admin. Restart the server (or redeploy it) with the latest code, then press Refresh.';
  }
  if (status === 401) return 'Your session expired — log in again.';
  if (status === 403) return serverMessage || 'Administrator access required.';
  if (status === 503) return serverMessage || 'The monitoring endpoint is unavailable right now.';
  if (status && serverMessage) return `${serverMessage} (HTTP ${status})`;
  if (status) return `The server answered HTTP ${status}.`;
  return 'The API did not answer. Start the backend with “npm run server”, then press Refresh.';
}

const AdminDashboard = () => {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastLoaded, setLastLoaded] = useState(null);
  const [reports, setReports] = useState([]);
  const [reportsError, setReportsError] = useState('');
  const [reportBusy, setReportBusy] = useState(null);
  const [verifications, setVerifications] = useState([]);
  const [verificationsError, setVerificationsError] = useState('');
  const [verificationBusy, setVerificationBusy] = useState(null);
  const [verificationFilter, setVerificationFilter] = useState('pending');
  const [verificationNotes, setVerificationNotes] = useState({});
  const [verificationChannels, setVerificationChannels] = useState({});
  const [funnel, setFunnel] = useState(null);
  const [funnelError, setFunnelError] = useState('');
  const [tab, setTab] = useState('overview');

  const isAdmin = user?.role === 'admin';
  const visibleTabs = tabsForRole(user?.role);

  // A moderator lands on the queue, never on an overview they cannot load.
  useEffect(() => {
    if (!user) return;
    const allowed = tabsForRole(user.role).map((entry) => entry.key);
    if (!allowed.includes(tab)) setTab(allowed[0]);
  }, [user, tab]);

  const load = useCallback(async () => {
    setError('');
    try {
      const { data: payload } = await axiosInstance.get('/admin/system-health');
      setData(payload);
      setLastLoaded(new Date());
    } catch (err) {
      setError(describeFailure(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFunnel = useCallback(async () => {
    try {
      const { data: payload } = await axiosInstance.get('/admin/funnel?days=28');
      setFunnel(payload);
      setFunnelError('');
    } catch (err) {
      setFunnelError(describeFailure(err));
    }
  }, []);

  const loadReports = useCallback(async () => {
    try {
      const { data: payload } = await axiosInstance.get('/admin/dm-reports?status=open');
      setReports(Array.isArray(payload.items) ? payload.items : []);
      setReportsError('');
    } catch (err) {
      setReportsError(describeFailure(err));
    }
  }, []);

  const resolveReport = async (reportId, status) => {
    setReportBusy(reportId);
    setReportsError('');
    try {
      await axiosInstance.post(`/admin/dm-reports/${reportId}/resolve`, { status });
      await loadReports();
    } catch (err) {
      setReportsError(describeFailure(err));
    } finally {
      setReportBusy(null);
    }
  };

  const loadVerifications = useCallback(async () => {
    try {
      const { data: payload } = await axiosInstance.get(
        `/admin/business-verifications?status=${verificationFilter}`
      );
      setVerifications(Array.isArray(payload.items) ? payload.items : []);
      setVerificationsError('');
    } catch (err) {
      setVerificationsError(describeFailure(err));
    }
  }, [verificationFilter]);

  const resolveVerification = async (profileId, status) => {
    setVerificationBusy(profileId);
    setVerificationsError('');
    try {
      await axiosInstance.post(`/admin/business-verifications/${profileId}/resolve`, {
        status,
        note: (verificationNotes[profileId] || '').trim()
      });
      await loadVerifications();
    } catch (err) {
      setVerificationsError(describeFailure(err));
    } finally {
      setVerificationBusy(null);
    }
  };

  const contactVerification = async (profileId, fallbackChannel) => {
    const message = (verificationNotes[profileId] || '').trim();
    if (!message) {
      setVerificationsError('Write a message before contacting the business.');
      return;
    }
    const channel = verificationChannels[profileId] || fallbackChannel || 'email';
    setVerificationBusy(profileId);
    setVerificationsError('');
    try {
      await axiosInstance.post(`/admin/business-verifications/${profileId}/contact`, {
        message,
        channel
      });
      await loadVerifications();
    } catch (err) {
      setVerificationsError(describeFailure(err));
    } finally {
      setVerificationBusy(null);
    }
  };

  const demoteVerification = async (profileId) => {
    const reason = (verificationNotes[profileId] || '').trim();
    if (reason.length < 5) {
      setVerificationsError('Write the demotion reason before returning the account to personal.');
      return;
    }
    setVerificationBusy(profileId);
    setVerificationsError('');
    try {
      await axiosInstance.post(`/admin/business-verifications/${profileId}/demote`, { reason });
      await loadVerifications();
    } catch (err) {
      setVerificationsError(describeFailure(err));
    } finally {
      setVerificationBusy(null);
    }
  };

  const refreshAll = useCallback(() => {
    load();
    loadFunnel();
    loadReports();
    loadVerifications();
  }, [load, loadFunnel, loadReports, loadVerifications]);

  useEffect(() => {
    // Overview data is admin-only and only needed while its tab is visible.
    if (user?.role !== 'admin' || tab !== 'overview') { setLoading(false); return undefined; }
    refreshAll();
    const timer = setInterval(refreshAll, 30_000);
    return () => clearInterval(timer);
  }, [user?.role, tab, refreshAll]);

  if (!user) {
    return (
      <main className="page">
        <div className="container">
          <div className="post-list-empty">
            <h3>Sign in required</h3>
            <p><Link to="/login">Log in</Link> with an administrator account.</p>
          </div>
        </div>
      </main>
    );
  }

  if (!['admin', 'moderator'].includes(user.role)) {
    return (
      <main className="page">
        <div className="container">
          <div className="post-list-empty">
            <h3>Staff only</h3>
            <p>This console is restricted to platform administrators and moderators.</p>
          </div>
        </div>
      </main>
    );
  }

  const security = data?.security;
  const health = data?.health;
  const counts = data?.database?.counts || {};
  const traffic = health?.traffic;
  const youtube = health?.services?.youtube;
  const observability = data?.observability;
  const funnelSteps = Array.isArray(funnel?.steps) ? funnel.steps : [];
  // A partial or failed funnel payload must never take the whole dashboard
  // down: render what exists and treat the missing counters as zero.
  const funnelDay7 = funnel?.day7 || { returned: 0, cohort: 0, rate: 0 };

  return (
    <main className="page">
      <div className="container">
        <div className="page-header">
          <div>
            <h1 className="page-title">Admin monitor</h1>
            <p className="page-subtitle">
              Key isolation, platform health, quotas and the live audit stream.
              {lastLoaded && ` Updated ${lastLoaded.toLocaleTimeString()}.`}
            </p>
          </div>
          {isAdmin && tab === 'overview' && (
            <button className="btn btn-ghost" onClick={refreshAll} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
        </div>

        <SegmentedTabs
          ariaLabel="Admin sections"
          options={visibleTabs}
          value={tab}
          onChange={setTab}
          size="sm"
          className="admin-tabs"
        />

        {error && (
          <div className="notice notice-error">
            <div>{error}</div>
            <div className="admin-error-meta">
              Endpoint: <code>/api/admin/system-health</code>
            </div>
          </div>
        )}

        {!data && loading && <AdminSkeleton />}

        {tab === 'overview' && data && (
          <>
            <section className="admin-grid">
              <div className="admin-card">
                <div className="admin-card-head">
                  <h2>API key security</h2>
                  <span className={`admin-badge ${security?.secretIsolation?.ok ? 'ok' : 'warn'}`}>
                    {security?.secretIsolation?.ok ? 'Isolated' : 'Needs attention'}
                  </span>
                </div>

                <ul className="key-list">
                  {(security?.secretIsolation?.keys || []).map((key) => (
                    <li key={key.name} className="key-row">
                      <span className="key-name">
                        {key.name}
                        {key.required && <em className="key-req">required</em>}
                      </span>
                      <span className="key-usage">{key.usedBy}</span>
                      <span className={`key-state ${key.configured ? 'ok' : key.required ? 'bad' : 'muted'}`}>
                        {key.configured ? (key.strength === 'short' ? 'set (short)' : 'set') : 'not set'}
                      </span>
                    </li>
                  ))}
                </ul>

                {(security?.secretIsolation?.missingRequired?.length > 0) && (
                  <p className="admin-warn">
                    Missing required secrets: {security.secretIsolation.missingRequired.join(', ')}
                  </p>
                )}

                <p className="admin-note">
                  Client bundle:{' '}
                  {security?.clientBundle?.scanned
                    ? security.clientBundle.leakedKeys.length
                      ? `leaked ${security.clientBundle.leakedKeys.join(', ')}`
                      : `clean (${security.clientBundle.files} asset${security.clientBundle.files === 1 ? '' : 's'} scanned)`
                    : security?.clientBundle?.reason || 'not scanned'}
                </p>
                <p className="admin-note">
                  Secrets are read only by the backend from environment variables. This page never shows their values.
                </p>
              </div>

              <div className="admin-card">
                <div className="admin-card-head">
                  <h2>Platform health</h2>
                  <span className={`admin-badge ${health?.database?.connected ? 'ok' : 'bad'}`}>
                    {health?.database?.state || 'unknown'}
                  </span>
                </div>

                <div className="admin-stats">
                  <Stat label="Uptime" value={formatUptime(health?.uptimeSeconds)} hint={`node ${health?.node || ''}`} />
                  <Stat label="Requests" value={traffic?.totalRequests ?? 0} hint="since boot" />
                  <Stat label="Avg latency" value={`${traffic?.avgLatencyMs ?? 0} ms`} hint={`p95 ${traffic?.p95LatencyMs ?? 0} ms`} />
                  <Stat label="Server errors" value={traffic?.serverErrors ?? 0} hint={`${traffic?.samples ?? 0} samples`} />
                </div>

                <div className="admin-services">
                  <div className="service-row">
                    <span>YouTube bot</span>
                    <span className={youtube?.configured ? 'ok' : 'muted'}>
                      {youtube?.configured ? 'configured' : 'no API key'}
                    </span>
                  </div>
                  {youtube?.configured && (
                    <p className="admin-note">
                      {youtube.cacheBackend || 'memory'} cache · {youtube.estimatedQuotaUnitsPerSync} quota units per sync
                      {youtube.lastSync && ` · last: ${youtube.lastSync.message}`}
                    </p>
                  )}
                  <div className="service-row">
                    <span>Cloudinary</span>
                    <span className={health?.services?.cloudinary?.configured ? 'ok' : 'muted'}>
                      {health?.services?.cloudinary?.configured ? 'configured' : 'not configured'}
                    </span>
                  </div>
                  <div className="service-row">
                    <span>{health?.services?.gameCatalog?.provider} catalog</span>
                    <span className="ok">{health?.services?.gameCatalog?.cacheMinutes} min cache</span>
                  </div>
                </div>

                <h3 className="admin-subhead">Launch instrumentation</h3>
                <div className="admin-services">
                  <div className="service-row">
                    <span>Request IDs</span>
                    <span className={observability?.requestIds ? 'ok' : 'warn'}>
                      {observability?.requestIds ? 'enabled' : 'missing'}
                    </span>
                  </div>
                  <div className="service-row">
                    <span>Error reporting</span>
                    <span className={observability?.errorReportingConfigured ? 'ok' : 'muted'}>
                      {observability?.errorReporting === 'sentry' ? 'Sentry' : 'structured JSON'}
                    </span>
                  </div>
                  <div className="service-row">
                    <span>Rate-limit store</span>
                    <span className={data?.rateLimits?.shared ? 'ok' : 'muted'}>
                      {data?.rateLimits?.mode || 'memory'}
                      {data?.rateLimits?.shared ? ' (shared)' : ' (local)'}
                    </span>
                  </div>
                  <div className="service-row">
                    <span>Release</span>
                    <span className="mono">{observability?.release || '—'}</span>
                  </div>
                  <div className="service-row">
                    <span>Product event retention</span>
                    <span className="muted">{observability?.productEventRetentionDays ?? 180} days</span>
                  </div>
                </div>

                {traffic?.rateLimits?.length > 0 && (
                  <>
                    <h3 className="admin-subhead">Rate-limit hits</h3>
                    <table className="admin-table">
                      <thead>
                        <tr><th>Limiter</th><th>Hits</th></tr>
                      </thead>
                      <tbody>
                        {traffic.rateLimits.map((entry) => (
                          <tr key={entry.name}>
                            <td className="mono">{entry.name}</td>
                            <td>{entry.hits}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}

                {traffic?.topRoutes?.length > 0 && (
                  <table className="admin-table">
                    <thead>
                      <tr><th>Route</th><th>Hits</th><th>Avg</th><th>Max</th></tr>
                    </thead>
                    <tbody>
                      {traffic.topRoutes.map((route) => (
                        <tr key={route.route}>
                          <td className="mono">{route.route}</td>
                          <td>{route.count}</td>
                          <td>{route.avgMs} ms</td>
                          <td>{route.maxMs} ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            <section className="admin-card">
              <div className="admin-card-head">
                <h2>Activation funnel</h2>
                <span className="admin-badge muted">
                  {funnel ? `${funnel.windowDays} days` : 'loading'}
                </span>
              </div>
              {funnelError && <p className="admin-warn">{funnelError}</p>}
              {!funnel && !funnelError && <p className="admin-note">Loading the funnel…</p>}
              {funnel && (
                <>
                  <p className="admin-note">
                    Distinct accounts per step. Day-7 is a cohort approximation from event timestamps,
                    not a warehouse-grade retention calculation.
                  </p>
                  {funnelSteps.length === 0 ? (
                    <p className="admin-note">No activation events in this window.</p>
                  ) : (
                    <table className="admin-table">
                      <thead>
                        <tr><th>Step</th><th>Users</th><th>From previous</th><th>From signup</th></tr>
                      </thead>
                      <tbody>
                        {funnelSteps.map((step) => (
                          <tr key={step.key}>
                            <td>
                              {step.label}
                              {step.eligibleUsers !== undefined && (
                                <span className="admin-stat-hint"> · {step.eligibleUsers} eligible</span>
                              )}
                            </td>
                            <td>{step.users}</td>
                            <td>{step.rateFromPrevious === null ? '—' : `${step.rateFromPrevious}%`}</td>
                            <td>{step.rateFromSignup}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <p className="admin-note">
                    {funnel.skippedOnboarding ?? 0} account{(funnel.skippedOnboarding ?? 0) === 1 ? '' : 's'} skipped onboarding ·{' '}
                    Day-7: {funnelDay7.returned} of {funnelDay7.cohort} eligible ({funnelDay7.rate}%).
                  </p>
                </>
              )}
            </section>

            <section className="admin-card">
              <div className="admin-card-head">
                <h2>Database</h2>
                <span className="admin-badge muted">{formatTime(data.generatedAt)}</span>
              </div>
              <div className="admin-stats">
                <Stat label="Users" value={counts.users ?? 0} />
                <Stat label="Posts" value={counts.posts ?? 0} />
                <Stat label="Comments" value={counts.comments ?? 0} />
                <Stat label="Servers" value={counts.communities ?? 0} />
                <Stat label="Messages" value={counts.messages ?? 0} />
                <Stat label="Open squads" value={counts.activeParties ?? 0} />
                <Stat label="Notifications" value={counts.notifications ?? 0} />
                <Stat label="Audit events" value={counts.auditEvents ?? 0} />
                <Stat label="Product events" value={counts.productEvents ?? 0} />
              </div>
            </section>

            <section className="admin-card">
              <div className="admin-card-head">
                <h2>Message reports</h2>
                <span className={`admin-badge ${reports.length > 0 ? 'warn' : 'muted'}`}>
                  {reports.length} open
                </span>
              </div>
              {reportsError && <p className="admin-warn">{reportsError}</p>}
              {reports.length === 0 ? (
                <p className="admin-note">No open message reports.</p>
              ) : (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Reporter</th>
                      <th>Reported</th>
                      <th>Reason</th>
                      <th>Report</th>
                      <th>Received</th>
                      <th>Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((report) => (
                      <tr key={report._id}>
                        <td>@{report.reporter?.username || 'deleted'}</td>
                        <td>@{report.reported?.username || 'deleted'}</td>
                        <td>{String(report.reason || '').replace(/_/g, ' ')}</td>
                        <td className="admin-report-note">
                          {report.note || 'No note'}
                          {report.messages?.length > 0 && (
                            <details>
                              <summary>
                                {report.messages.length} reported message{report.messages.length === 1 ? '' : 's'}
                              </summary>
                              {report.messages.map((message) => (
                                <p key={message._id}>{message.text}</p>
                              ))}
                            </details>
                          )}
                        </td>
                        <td>{formatTime(report.createdAt)}</td>
                        <td>
                          <div className="admin-report-actions">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => resolveReport(report._id, 'dismissed')}
                              disabled={reportBusy === report._id}
                            >
                              Dismiss
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => resolveReport(report._id, 'actioned')}
                              disabled={reportBusy === report._id}
                            >
                              Actioned
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="admin-card">
              <div className="admin-card-head">
                <h2>Business verification</h2>
                <div className="admin-report-actions">
                  <select
                    className="form-input"
                    style={{ maxWidth: 160 }}
                    value={verificationFilter}
                    onChange={(event) => setVerificationFilter(event.target.value)}
                    aria-label="Business verification status"
                  >
                    <option value="pending">Pending review</option>
                    <option value="verified">Verified</option>
                    <option value="rejected">Rejected</option>
                    <option value="expired">Expired</option>
                    <option value="all">All records</option>
                  </select>
                  <span className={`admin-badge ${verifications.length > 0 ? 'warn' : 'muted'}`}>
                    {verifications.length} shown
                  </span>
                </div>
              </div>
              {verificationsError && <p className="admin-warn">{verificationsError}</p>}
              {verifications.length === 0 ? (
                <p className="admin-note">No business verification requests match this filter.</p>
              ) : (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Business</th>
                      <th>Domain</th>
                      <th>Method</th>
                      <th>Requested</th>
                      <th>Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {verifications.map((item) => (
                      <tr key={item._id}>
                        <td>@{item.user?.username || 'deleted'}</td>
                        <td>
                          <strong>{item.business?.displayName || 'Business'}</strong>
                          <div className="admin-report-note">{item.business?.website || 'No website'}</div>
                          <details className="admin-report-note">
                            <summary>Proof and contact</summary>
                            <p>
                              Contact: {item.business?.contactMethod || 'email'}
                              {' — '}
                              {item.business?.contactMethod === 'email'
                                ? (item.business?.contactEmail || 'no contact email')
                                : (item.business?.contactDetail || 'no detail')}
                            </p>
                            <p>
                              Proof: {item.business?.proofType || 'other'}
                              {item.business?.proofUrl && (
                                <>
                                  {' — '}
                                  <a href={item.business.proofUrl} target="_blank" rel="noreferrer">
                                    open link
                                  </a>
                                </>
                              )}
                            </p>
                            {item.business?.proofNote && <p>{item.business.proofNote}</p>}
                            <p>
                              Last contacted: {item.reviewContactedAt
                                ? formatTime(item.reviewContactedAt)
                                : 'not yet'}
                            </p>
                            <p>
                              Decision recorded: {item.business?.reviewDecidedAt
                                ? formatTime(item.business.reviewDecidedAt)
                                : 'not yet'}
                            </p>
                            {item.business?.evidencePurgedAt && (
                              <p>
                                Evidence removed by retention on{' '}
                                {formatTime(item.business.evidencePurgedAt)}
                              </p>
                            )}
                            {item.reviewContactedAt && (
                              <p>
                                Response window:{' '}
                                {item.demotion?.canDemote
                                  ? `closed ${formatTime(item.demotion.earliestDemotionAt)}`
                                  : `open until ${formatTime(item.demotion?.earliestDemotionAt)}`}
                              </p>
                            )}
                            {item.business?.reviewRespondedAt && (
                              <>
                                <p>
                                  Business responded: {formatTime(item.business.reviewRespondedAt)}
                                </p>
                                <p className="admin-business-response">
                                  {item.business.reviewResponseNote}
                                </p>
                              </>
                            )}
                          </details>
                        </td>
                        <td className="mono">{item.business?.verificationDomain || '—'}</td>
                        <td>{item.business?.verificationMethod || 'manual'}</td>
                        <td>{formatTime(item.requestedAt)}</td>
                        <td>
                          <select
                            className="form-input"
                            style={{ maxWidth: 160, marginBottom: 8 }}
                            value={verificationChannels[item._id]
                              || item.business?.contactMethod
                              || 'email'}
                            onChange={(event) => setVerificationChannels((previous) => ({
                              ...previous,
                              [item._id]: event.target.value
                            }))}
                            aria-label={`Contact channel for ${item.business?.displayName || 'business'}`}
                          >
                            <option value="email">Email</option>
                            <option value="phone">Phone</option>
                            <option value="other">Other</option>
                          </select>
                          <input
                            className="form-input"
                            style={{ minWidth: 180, marginBottom: 8 }}
                            value={verificationNotes[item._id] || ''}
                            onChange={(event) => setVerificationNotes((previous) => ({
                              ...previous,
                              [item._id]: event.target.value
                            }))}
                            placeholder="Message or decision note"
                            aria-label={`Review note for ${item.business?.displayName || 'business'}`}
                          />
                          <div className="admin-report-actions">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => contactVerification(item._id, item.business?.contactMethod)}
                              disabled={verificationBusy === item._id || !(verificationNotes[item._id] || '').trim()}
                              title={(verificationChannels[item._id]
                                || item.business?.contactMethod
                                || 'email') === 'email'
                                ? 'Send this message to the official contact by email'
                                : 'Record a contact you already made by phone or another method; no email is sent'}
                            >
                              {(verificationChannels[item._id]
                                || item.business?.contactMethod
                                || 'email') === 'email'
                                ? 'Email contact'
                                : 'Record contact'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => resolveVerification(item._id, 'rejected')}
                              disabled={verificationBusy === item._id}
                            >
                              Reject
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => resolveVerification(item._id, 'verified')}
                              disabled={verificationBusy === item._id}
                            >
                              {item.business?.verificationStatus === 'verified' ? 'Clear pause' : 'Verify'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => demoteVerification(item._id)}
                              disabled={
                                verificationBusy === item._id
                                || !item.demotion?.canDemote
                                || (verificationNotes[item._id] || '').trim().length < 5
                              }
                              title={item.demotion?.canDemote
                                ? (verificationNotes[item._id] || '').trim().length >= 5
                                  ? 'Return the account to a personal profile'
                                  : 'Write the demotion reason first'
                                : item.demotion?.code === 'BUSINESS_RESPONSE_WINDOW'
                                  ? `Contact logged. Demote opens ${formatTime(item.demotion.earliestDemotionAt)}.`
                                  : item.demotion?.reason || 'Contact the business first'}
                            >
                              Demote
                            </button>
                          </div>
                          {!item.demotion?.canDemote
                            && (item.reviewContactedAt || item.business?.verificationStatus === 'pending') && (
                            <p className="admin-note">
                              {item.demotion?.code === 'BUSINESS_RESPONSE_WINDOW'
                                ? `Contact logged. Demote opens ${formatTime(item.demotion.earliestDemotionAt)}${item.demotion.daysRemaining
                                  ? ` (${item.demotion.daysRemaining} day${item.demotion.daysRemaining === 1 ? '' : 's'} left)`
                                  : ''}.`
                                : item.demotion?.reason || 'Contact the business first.'}
                            </p>
                          )}
                          {item.demotion?.canDemote && item.business?.reviewRespondedAt && (
                            <p className="admin-note">
                              Read the response above before deciding.
                            </p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="admin-card">
              <div className="admin-card-head">
                <h2>Live audit stream</h2>
                <span className="admin-badge muted">latest 20</span>
              </div>
              {data.audit?.length ? (
                <ul className="audit-stream">
                  {data.audit.map((entry) => (
                    <li key={entry._id} className="audit-row">
                      <span className="audit-action">{entry.actionType}</span>
                      <span className="audit-actor">@{entry.actor}</span>
                      <span className="audit-community">{entry.community || 'platform'}</span>
                      <span className="audit-time">{formatTime(entry.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="admin-note">No moderation events recorded yet.</p>
              )}
            </section>
          </>
        )}

        {tab !== 'overview' && <AdminPanels tab={tab} />}
      </div>
    </main>
  );
};

export default AdminDashboard;
