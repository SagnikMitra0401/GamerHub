import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import axiosInstance from '../../api/axiosInstance';
import { CloseIcon } from '../common/icons';

const STATUS_TABS = ['open', 'reviewed', 'dismissed'];

const reasonLabel = (reason) => String(reason).replace(/_/g, ' ');

/**
 * Moderator report queue.
 * The reporter is shown to moderators only; the reported member never learns
 * that a report exists, who filed it, or how it was resolved.
 */
const ReportsModal = ({ isOpen, onClose, communityId }) => {
  const [status, setStatus] = useState('open');
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!communityId) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await axiosInstance.get(`/communities/${communityId}/reports?status=${status}`);
      setReports(data.reports || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load reports.');
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [communityId, status]);

  useEffect(() => {
    if (!isOpen) return undefined;
    load();
    return undefined;
  }, [isOpen, load]);

  if (!isOpen) return null;

  const resolve = async (report, nextStatus) => {
    setBusyId(report._id);
    try {
      await axiosInstance.patch(`/communities/${communityId}/reports/${report._id}`, { status: nextStatus });
      setReports(prev => prev.filter(row => row._id !== report._id));
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update that report.');
    } finally {
      setBusyId(null);
    }
  };

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="reports-title">
      <div className="modal-box reports-modal-box" onClick={event => event.stopPropagation()}>
        <div className="modal-header-row">
          <h2 id="reports-title" className="modal-title" style={{ margin: 0 }}>Report queue</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="forum-filters" style={{ marginBottom: '0.75rem' }}>
          {STATUS_TABS.map(key => (
            <button
              key={key}
              type="button"
              className={`forum-filter${status === key ? ' active' : ''}`}
              onClick={() => setStatus(key)}
            >
              {key}
            </button>
          ))}
        </div>

        {error && <div className="form-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}

        {loading ? (
          <div className="spinner" />
        ) : reports.length === 0 ? (
          <p className="text-muted" style={{ textAlign: 'center', padding: '1.5rem 0' }}>
            Nothing in the {status} queue.
          </p>
        ) : (
          <div className="report-list">
            {reports.map(report => (
              <div key={report._id} className="report-row">
                <div className="report-head">
                  <span className="report-reason">{reasonLabel(report.reason)}</span>
                  <span className="report-target">{report.targetType}</span>
                  <span className="chat-timestamp">{new Date(report.createdAt).toLocaleString()}</span>
                </div>

                <div className="report-preview">
                  {report.targetPreview?.text
                    || report.targetPreview?.title
                    || report.targetPreview?.username
                    || 'Content unavailable'}
                </div>

                {report.note && <p className="report-note">“{report.note}”</p>}
                <p className="report-meta">Reported by {report.reporter?.username || 'unknown'}</p>

                {report.status === 'open' && (
                  <div className="report-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busyId === report._id}
                      onClick={() => resolve(report, 'dismissed')}
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={busyId === report._id}
                      onClick={() => resolve(report, 'reviewed')}
                    >
                      Mark reviewed
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default ReportsModal;
