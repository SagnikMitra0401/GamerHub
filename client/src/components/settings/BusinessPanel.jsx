import React, { useEffect, useState } from 'react';
import axiosInstance from '../../api/axiosInstance';
import { AlertIcon, BriefcaseIcon, CheckIcon, LinkIcon, UsersIcon } from '../common/icons';

const EMPTY = {
  displayName: '',
  category: 'creator',
  description: '',
  website: '',
  supportEmail: '',
  timezone: '',
  responseExpectation: '',
  links: []
};

const CATEGORY_OPTIONS = [
  { value: 'creator', label: 'Creator' },
  { value: 'esports', label: 'Esports' },
  { value: 'studio', label: 'Studio' },
  { value: 'brand', label: 'Brand' },
  { value: 'other', label: 'Other' }
];

const STATUS_LABELS = {
  none: 'Not verified',
  pending: 'Review pending',
  verified: 'Verified',
  rejected: 'Not approved'
};

const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '');

const BusinessPanel = ({ account, refresh, notify }) => {
  const profile = account.businessProfile;
  const enabled = account.profileType === 'creator_business';
  const [form, setForm] = useState(EMPTY);
  const [linksText, setLinksText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [instructions, setInstructions] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [team, setTeam] = useState({ items: [], maxSize: 10 });
  const [teamUsername, setTeamUsername] = useState('');
  const [teamRole, setTeamRole] = useState('viewer');
  const [teamBusy, setTeamBusy] = useState(null);
  const [teamError, setTeamError] = useState('');

  useEffect(() => {
    const source = profile || EMPTY;
    setForm({
      displayName: source.displayName || '',
      category: source.category || 'creator',
      description: source.description || '',
      website: source.website || '',
      supportEmail: source.supportEmail || '',
      timezone: source.timezone || '',
      responseExpectation: source.responseExpectation || '',
      links: source.links || []
    });
    setLinksText((source.links || []).join('\n'));
  }, [profile]);

  useEffect(() => {
    if (!enabled) {
      setAnalytics(null);
      return undefined;
    }
    let cancelled = false;
    axiosInstance.get('/account/business/analytics')
      .then(({ data }) => { if (!cancelled) setAnalytics(data); })
      .catch(() => { if (!cancelled) setAnalytics(null); });
    return () => { cancelled = true; };
  }, [enabled, profile?.verificationStatus]);

  useEffect(() => {
    if (!enabled) {
      setTeam({ items: [], maxSize: 10 });
      return undefined;
    }
    let cancelled = false;
    const loadTeam = () => axiosInstance.get('/account/business/team')
      .then(({ data }) => { if (!cancelled) setTeam(data); })
      .catch(() => { if (!cancelled) setTeam({ items: [], maxSize: 10 }); });

    loadTeam();

    // A teammate accepts in their own session, so this list must not keep
    // saying "Invite pending" until a full page reload. Refetch on return.
    const refreshOnFocus = () => { if (!document.hidden) loadTeam(); };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnFocus);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnFocus);
    };
  }, [enabled]);

  const patch = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));

  const dirty = JSON.stringify({
    ...form,
    links: linksText.split('\n').map((link) => link.trim()).filter(Boolean)
  }) !== JSON.stringify(profile || EMPTY);

  const save = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        links: linksText.split('\n').map((link) => link.trim()).filter(Boolean)
      };
      await axiosInstance.post('/account/business-profile', payload);
      await refresh();
      notify('success', 'Business profile saved.');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save your business profile.');
    } finally {
      setSaving(false);
    }
  };

  const requestVerification = async (method) => {
    setBusy(method);
    setError('');
    setInstructions(null);
    try {
      const { data } = await axiosInstance.post('/account/business-verification', { method });
      if (data?.instructions) setInstructions(data.instructions);
      await refresh();
      notify('success', method === 'dns' ? 'DNS review requested.' : 'Manual review requested.');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not request verification.');
    } finally {
      setBusy(null);
    }
  };

  const checkDns = async () => {
    setBusy('check-dns');
    setError('');
    try {
      await axiosInstance.post('/account/business-verification/check');
      await refresh();
      notify('success', 'Domain verified. Cold outreach is now available.');
    } catch (err) {
      setError(err.response?.data?.message || 'The DNS record could not be verified yet.');
    } finally {
      setBusy(null);
    }
  };

  const inviteTeamMember = async (event) => {
    event.preventDefault();
    if (!teamUsername.trim() || teamBusy) return;
    setTeamBusy('invite');
    setTeamError('');
    try {
      await axiosInstance.post('/account/business/team', {
        username: teamUsername.trim(),
        role: teamRole
      });
      const { data } = await axiosInstance.get('/account/business/team');
      setTeam(data);
      setTeamUsername('');
      notify('success', 'Invitation sent. They must accept before seeing any thread.');
    } catch (err) {
      setTeamError(err.response?.data?.message || 'Could not send that invitation.');
    } finally {
      setTeamBusy(null);
    }
  };

  const updateTeamRole = async (memberId, role) => {
    setTeamBusy(`role-${memberId}`);
    setTeamError('');
    try {
      await axiosInstance.patch(`/account/business/team/${memberId}`, { role });
      const { data } = await axiosInstance.get('/account/business/team');
      setTeam(data);
    } catch (err) {
      setTeamError(err.response?.data?.message || 'Could not change that role.');
    } finally {
      setTeamBusy(null);
    }
  };

  const removeTeamMember = async (memberId) => {
    setTeamBusy(`remove-${memberId}`);
    setTeamError('');
    try {
      await axiosInstance.delete(`/account/business/team/${memberId}`);
      const { data } = await axiosInstance.get('/account/business/team');
      setTeam(data);
      notify('success', 'Team access removed.');
    } catch (err) {
      setTeamError(err.response?.data?.message || 'Could not remove that teammate.');
    } finally {
      setTeamBusy(null);
    }
  };

  const downgrade = async () => {
    setBusy('downgrade');
    setError('');
    try {
      await axiosInstance.delete('/account/business-profile');
      await refresh();
      notify('success', 'Your profile is personal again. The business record is kept for audit.');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not switch back to a personal profile.');
    } finally {
      setBusy(null);
    }
  };

  const status = profile?.verificationStatus || 'none';
  const dnsToken = instructions?.recordValue
    || (profile?.verificationToken ? `gamerhub-verify=${profile.verificationToken}` : '');
  const dnsDomain = instructions?.domain || profile?.verificationDomain || '';

  return (
    <>
      <section className="settings-section">
        <div className="settings-section-head">
          <h3>
            <BriefcaseIcon size={15} /> Business account
          </h3>
          <p>
            Keep one login and one follower graph. A business label tells people who they are
            talking to; it never grants extra reach or bypasses their message rules.
          </p>
        </div>

        <div className={`settings-business-status${status === 'verified' ? ' is-verified' : ''}`}>
          <span className="settings-business-icon" aria-hidden="true">
            {status === 'verified' ? <CheckIcon size={17} /> : <BriefcaseIcon size={17} />}
          </span>
          <div>
            <strong>{STATUS_LABELS[status] || STATUS_LABELS.none}</strong>
            <span>
              {enabled
                ? 'Your profile shows a Business label wherever your handle appears.'
                : 'Saving this form switches your profile to business mode.'}
            </span>
          </div>
        </div>

        {profile?.outreachPaused && (
          <p className="settings-business-alert">
            <AlertIcon size={14} /> Cold outreach is paused while recent reports are reviewed.
            Existing conversations still work.
          </p>
        )}

        <form onSubmit={save}>
          <div className="settings-grid-2">
            <label className="form-group" htmlFor="business-display-name">
              <span className="form-label">Business display name</span>
              <input
                id="business-display-name"
                className="form-input"
                value={form.displayName}
                onChange={(event) => patch('displayName', event.target.value.slice(0, 80))}
                placeholder="Studio or brand name"
                maxLength={80}
                required
              />
            </label>
            <label className="form-group" htmlFor="business-category">
              <span className="form-label">Category</span>
              <select
                id="business-category"
                className="form-input"
                value={form.category}
                onChange={(event) => patch('category', event.target.value)}
              >
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="form-group" htmlFor="business-description">
            <span className="form-label">What the business does</span>
            <textarea
              id="business-description"
              className="form-input"
              value={form.description}
              onChange={(event) => patch('description', event.target.value.slice(0, 600))}
              placeholder="A short, public description of your work."
              rows={3}
              maxLength={600}
            />
          </label>

          <div className="settings-grid-2">
            <label className="form-group" htmlFor="business-website">
              <span className="form-label">Website</span>
              <input
                id="business-website"
                className="form-input"
                value={form.website}
                onChange={(event) => patch('website', event.target.value)}
                placeholder="https://studio.example"
                maxLength={200}
              />
              <span className="settings-help">HTTPS only. This domain is used for verification.</span>
            </label>
            <label className="form-group" htmlFor="business-support-email">
              <span className="form-label">Public support email</span>
              <input
                id="business-support-email"
                className="form-input"
                type="email"
                value={form.supportEmail}
                onChange={(event) => patch('supportEmail', event.target.value)}
                placeholder="hello@studio.example"
                maxLength={120}
              />
            </label>
          </div>

          <div className="settings-grid-2">
            <label className="form-group" htmlFor="business-timezone">
              <span className="form-label">Working timezone</span>
              <input
                id="business-timezone"
                className="form-input"
                value={form.timezone}
                onChange={(event) => patch('timezone', event.target.value.slice(0, 60))}
                placeholder="Europe/London"
                maxLength={60}
              />
            </label>
            <label className="form-group" htmlFor="business-response">
              <span className="form-label">Response expectation</span>
              <input
                id="business-response"
                className="form-input"
                value={form.responseExpectation}
                onChange={(event) => patch('responseExpectation', event.target.value.slice(0, 80))}
                placeholder="Replies within 3 working days"
                maxLength={80}
              />
            </label>
          </div>

          <label className="form-group" htmlFor="business-links">
            <span className="form-label">Public links</span>
            <textarea
              id="business-links"
              className="form-input"
              value={linksText}
              onChange={(event) => setLinksText(event.target.value)}
              placeholder={'https://studio.example/portfolio\nhttps://studio.example/press'}
              rows={3}
            />
            <span className="settings-help">One HTTPS link per line, up to five.</span>
          </label>

          {error && (
            <p className="settings-inline-error" role="alert">
              <AlertIcon size={13} /> {error}
            </p>
          )}

          <div className="settings-actions">
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !dirty || !form.displayName.trim()}>
              {saving ? 'Saving...' : enabled ? 'Save business profile' : 'Switch to business profile'}
            </button>
            {enabled && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={downgrade} disabled={busy === 'downgrade'}>
                {busy === 'downgrade' ? 'Switching...' : 'Return to personal profile'}
              </button>
            )}
          </div>
        </form>
      </section>

      {enabled && (
        <section className="settings-section">
          <div className="settings-section-head">
            <h3>
              <CheckIcon size={15} /> Outreach verification
            </h3>
            <p>
              A business can cold-contact people only after the domain is reviewed. Mutual
              conversations and replies keep working in the meantime.
            </p>
          </div>

          <div className="settings-business-status">
            <span className="settings-business-icon" aria-hidden="true"><BriefcaseIcon size={17} /></span>
            <div>
              <strong>{STATUS_LABELS[status] || STATUS_LABELS.none}</strong>
              <span>
                {status === 'verified' && profile?.verifiedAt
                  ? `Verified ${formatDate(profile.verifiedAt)}.`
                  : profile?.verificationDomain
                    ? `Domain: ${profile.verificationDomain}. A matching DNS record verifies automatically.`
                    : 'Add a website, then request DNS or manual review.'}
              </span>
            </div>
          </div>

          {status === 'pending' && dnsToken && (
            <div className="settings-business-record">
              <div>
                <span>DNS record</span>
                <strong>{`_gamerhub-verify.${dnsDomain || 'your-domain'}`}</strong>
              </div>
              <div>
                <span>TXT value</span>
                <code>{dnsToken}</code>
              </div>
              <p>Add the record, then check it here. The server reads the TXT record directly; no administrator is needed for a matching domain.</p>
              {profile?.verificationMethod === 'dns' && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={checkDns}
                  disabled={busy === 'check-dns'}
                >
                  {busy === 'check-dns' ? 'Checking DNS...' : 'Check DNS now'}
                </button>
              )}
            </div>
          )}

          {status !== 'verified' && (
            <div className="settings-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => requestVerification('dns')}
                disabled={busy === 'dns' || !form.website.trim()}
              >
                {busy === 'dns' ? 'Requesting...' : 'Request DNS review'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => requestVerification('manual')}
                disabled={busy === 'manual'}
              >
                {busy === 'manual' ? 'Requesting...' : 'Request manual review'}
              </button>
            </div>
          )}

          {analytics && (
            <div className="settings-business-analytics">
              <div><strong>{analytics.sent}</strong><span>business requests sent</span></div>
              <div><strong>{analytics.accepted}</strong><span>accepted</span></div>
              <div><strong>{analytics.acceptanceRate == null ? '—' : `${analytics.acceptanceRate}%`}</strong><span>acceptance</span></div>
              <div><strong>{analytics.active}</strong><span>active threads</span></div>
            </div>
          )}
        </section>
      )}

      {enabled && (
        <section className="settings-section">
          <div className="settings-section-head">
            <h3>
              <UsersIcon size={15} /> Team inbox
            </h3>
            <p>
              Invite a trusted teammate to a shared business inbox. They never see your personal
              threads. Viewers can read; agents can reply and answer requests.
            </p>
          </div>

          <form className="settings-team-invite" onSubmit={inviteTeamMember}>
            <input
              className="form-input"
              value={teamUsername}
              onChange={(event) => setTeamUsername(event.target.value.slice(0, 20))}
              placeholder="Teammate username"
              aria-label="Teammate username"
              maxLength={20}
            />
            <select
              className="form-input"
              value={teamRole}
              onChange={(event) => setTeamRole(event.target.value)}
              aria-label="Team role"
            >
              <option value="viewer">Viewer</option>
              <option value="agent">Agent</option>
            </select>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={teamBusy === 'invite' || !teamUsername.trim()}
            >
              {teamBusy === 'invite' ? 'Inviting...' : 'Invite'}
            </button>
          </form>

          {teamError && (
            <p className="settings-inline-error" role="alert">
              <AlertIcon size={13} /> {teamError}
            </p>
          )}

          {(team.items || []).length === 0 ? (
            <p className="settings-help">No teammates yet. An invitation grants nothing until it is accepted.</p>
          ) : (
            <ul className="settings-team-list">
              {team.items.map((entry) => (
                <li key={entry._id}>
                  <div className="settings-team-person">
                    <strong>@{entry.username}</strong>
                    <span>{entry.status === 'active' ? 'Active' : entry.status === 'invited' ? 'Invite pending' : entry.status}</span>
                  </div>
                  <select
                    className="form-input settings-team-role"
                    value={entry.role}
                    onChange={(event) => updateTeamRole(entry.memberId, event.target.value)}
                    disabled={teamBusy === `role-${entry.memberId}`}
                    aria-label={`Role for ${entry.username}`}
                  >
                    <option value="viewer">Viewer</option>
                    <option value="agent">Agent</option>
                  </select>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => removeTeamMember(entry.memberId)}
                    disabled={teamBusy === `remove-${entry.memberId}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="settings-help">Up to {team.maxSize || 10} people. Only business threads are shared.</p>
        </section>
      )}

      {enabled && (
        <section className="settings-section">
          <div className="settings-section-head">
            <h3>
              <LinkIcon size={15} /> Public business card
            </h3>
            <p>
              This is the information people see next to your Business label. It is separate from
              verification: a verified business can still have an incomplete public card.
            </p>
          </div>
          <p className="settings-help">
            The card is published on your gamer profile. Verification status is shown as Verified
            only after staff approval.
          </p>
        </section>
      )}
    </>
  );
};

export default BusinessPanel;
