import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';
import { AdminSkeleton } from '../components/common/Skeleton';

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
      const { data: payload } = await axiosInstance.get('/admin/business-verifications?status=pending');
      setVerifications(Array.isArray(payload.items) ? payload.items : []);
      setVerificationsError('');
    } catch (err) {
      setVerificationsError(describeFailure(err));
    }
  }, []);

  const resolveVerification = async (profileId, status) => {
    setVerificationBusy(profileId);
    setVerificationsError('');
    try {
      await axiosInstance.post(`/admin/business-verifications/${profileId}/resolve`, { status });
      await loadVerifications();
    } catch (err) {
      setVerificationsError(describeFailure(err));
    } finally {
      setVerificationBusy(null);
    }
  };

  useEffect(() => {
    if (user?.role !== 'admin') { setLoading(false); return undefined; }
    load();
    loadReports();
    loadVerifications();
    const timer = setInterval(() => {
      load();
      loadReports();
      loadVerifications();
    }, 30_000);
    return () => clearInterval(timer);
  }, [user?.role, load, loadReports, loadVerifications]);

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

  if (user.role !== 'admin') {
    return (
      <main className="page">
        <div className="container">
          <div className="post-list-empty">
            <h3>Admins only</h3>
            <p>This dashboard is restricted to platform administrators.</p>
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
          <button className="btn btn-ghost" onClick={load} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div className="notice notice-error">
            <div>{error}</div>
            <div className="admin-error-meta">
              Endpoint: <code>/api/admin/system-health</code>
            </div>
          </div>
        )}

        {!data && loading && <AdminSkeleton />}

        {data && (
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
                <span className={`admin-badge ${verifications.length > 0 ? 'warn' : 'muted'}`}>
                  {verifications.length} need review
                </span>
              </div>
              {verificationsError && <p className="admin-warn">{verificationsError}</p>}
              {verifications.length === 0 ? (
                <p className="admin-note">No business verification requests are waiting.</p>
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
                        </td>
                        <td className="mono">{item.business?.verificationDomain || '—'}</td>
                        <td>{item.business?.verificationMethod || 'manual'}</td>
                        <td>{formatTime(item.requestedAt)}</td>
                        <td>
                          <div className="admin-report-actions">
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
      </div>
    </main>
  );
};

export default AdminDashboard;
