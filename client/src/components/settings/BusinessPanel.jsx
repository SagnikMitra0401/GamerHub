import React, { useEffect, useState } from 'react';
import axiosInstance from '../../api/axiosInstance';
import { AlertIcon, BriefcaseIcon, CheckIcon, LinkIcon, UsersIcon } from '../common/icons';

const EMPTY = {
  displayName: '',
  category: 'creator',
  description: '',
  website: '',
  supportEmail: '',
  contactEmail: '',
  contactMethod: 'email',
  contactDetail: '',
  proofType: 'registration',
  proofUrl: '',
  proofNote: '',
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
  rejected: 'Not approved',
  expired: 'Application expired'
};

const CONTACT_METHOD_OPTIONS = [
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'other', label: 'Other method' }
];

const PROOF_TYPE_OPTIONS = [
  { value: 'registration', label: 'Business registration' },
  { value: 'tax', label: 'Tax or VAT registration' },
  { value: 'domain_email', label: 'Domain email on the official website' },
  { value: 'official_profile', label: 'Official business profile or listing' },
  { value: 'other', label: 'Other evidence' }
];

const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '');

const formSnapshot = (source = EMPTY) => ({
  displayName: source.displayName || '',
  category: source.category || 'creator',
  description: source.description || '',
  website: source.website || '',
  supportEmail: source.supportEmail || '',
  contactEmail: source.contactEmail || '',
  contactMethod: source.contactMethod || 'email',
  contactDetail: source.contactDetail || '',
  proofType: source.proofType || 'registration',
  proofUrl: source.proofUrl || '',
  proofNote: source.proofNote || '',
  timezone: source.timezone || '',
  responseExpectation: source.responseExpectation || '',
  links: source.links || []
});

const BusinessPanel = ({ account, refresh, notify }) => {
  const profile = account.businessProfile;
  const enabled = account.profileType === 'creator_business';
  const [form, setForm] = useState(EMPTY);
  const [linksText, setLinksText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [instructions, setInstructions] = useState(null);
  const [reviewResponse, setReviewResponse] = useState('');
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
      contactEmail: source.contactEmail || '',
      contactMethod: source.contactMethod || 'email',
      contactDetail: source.contactDetail || '',
      proofType: source.proofType || 'registration',
      proofUrl: source.proofUrl || '',
      proofNote: source.proofNote || '',
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
  }) !== JSON.stringify(formSnapshot(profile || EMPTY));

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

  const respondToReview = async (event) => {
    event.preventDefault();
    const note = reviewResponse.trim();
    if (note.length < 10 || busy) return;
    setBusy('respond');
    setError('');
    try {
      await axiosInstance.post('/account/business-verification/respond', { note });
      setReviewResponse('');
      await refresh();
      notify('success', 'Your response was sent to the review team.');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not send your response.');
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
  // A purge marker only applies to the review round it happened in. A later
  // contact (or a re-application) starts a new round that may be answered.
  const reviewEvidencePurged = Boolean(
    profile?.evidencePurgedAt
    && (!profile.reviewContactedAt
      || new Date(profile.reviewContactedAt) <= new Date(profile.evidencePurgedAt))
  );
  const hasContactRoute = form.contactMethod === 'email'
    ? Boolean(form.contactEmail.trim() || form.supportEmail.trim())
    : Boolean(form.contactDetail.trim());
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

        {profile?.reviewContactedAt && !profile?.demotedAt && !reviewEvidencePurged && status !== 'rejected' && (
          <p className="settings-business-alert">
            <AlertIcon size={14} /> A reviewer contacted your official contact on{' '}
            {formatDate(profile.reviewContactedAt)}. Check that inbox, including spam.
          </p>
        )}

        {profile?.demotedAt && (
          <p className="settings-business-alert">
            <AlertIcon size={14} /> This account was returned to a personal profile on{' '}
            {formatDate(profile.demotedAt)}. {profile.demotionReason}
          </p>
        )}

        {status === 'expired' && (
          <p className="settings-business-alert">
            <AlertIcon size={14} /> The last review request expired after 90 days without
            activity, or because it stayed open for a year. Request review again when your
            details are ready.
          </p>
        )}

        {reviewEvidencePurged && (
          <p className="settings-help">
            Review evidence was removed on {formatDate(profile.evidencePurgedAt)} under the
            retention policy. Add it again if you apply for review.
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

          <div className="settings-business-contact">
            <p className="settings-help">
              <strong>Verification contact and evidence.</strong> Reviewers use these details. They
              are never shown on your public business card.
            </p>
            <div className="settings-grid-2">
              <label className="form-group" htmlFor="business-contact-email">
                <span className="form-label">Official contact email</span>
                <input
                  id="business-contact-email"
                  className="form-input"
                  type="email"
                  value={form.contactEmail}
                  onChange={(event) => patch('contactEmail', event.target.value)}
                  placeholder="owner@studio.example"
                  maxLength={120}
                />
              </label>
              <label className="form-group" htmlFor="business-contact-method">
                <span className="form-label">Preferred contact method</span>
                <select
                  id="business-contact-method"
                  className="form-input"
                  value={form.contactMethod}
                  onChange={(event) => patch('contactMethod', event.target.value)}
                >
                  {CONTACT_METHOD_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>

            {form.contactMethod !== 'email' && (
              <label className="form-group" htmlFor="business-contact-detail">
                <span className="form-label">Phone number or other contact</span>
                <input
                  id="business-contact-detail"
                  className="form-input"
                  value={form.contactDetail}
                  onChange={(event) => patch('contactDetail', event.target.value.slice(0, 120))}
                  placeholder="+1 555 0100 or @studio on X"
                  maxLength={120}
                />
              </label>
            )}

            <div className="settings-grid-2">
              <label className="form-group" htmlFor="business-proof-type">
                <span className="form-label">Proof of business</span>
                <select
                  id="business-proof-type"
                  className="form-input"
                  value={form.proofType}
                  onChange={(event) => patch('proofType', event.target.value)}
                >
                  {PROOF_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="form-group" htmlFor="business-proof-url">
                <span className="form-label">Public proof link</span>
                <input
                  id="business-proof-url"
                  className="form-input"
                  value={form.proofUrl}
                  onChange={(event) => patch('proofUrl', event.target.value)}
                  placeholder="https://registry.example/company/123"
                  maxLength={300}
                />
                <span className="settings-help">HTTPS only. A registry, tax or official listing page.</span>
              </label>
            </div>

            <label className="form-group" htmlFor="business-proof-note">
              <span className="form-label">What this proves</span>
              <textarea
                id="business-proof-note"
                className="form-input"
                value={form.proofNote}
                onChange={(event) => patch('proofNote', event.target.value.slice(0, 600))}
                placeholder="Explain the link, or describe other evidence a reviewer can check."
                rows={3}
                maxLength={600}
              />
            </label>
          </div>

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

          {profile?.reviewContactedAt && !profile?.demotedAt && !reviewEvidencePurged && status !== 'rejected' && (
            <div className="settings-business-review">
              <p className="settings-help">
                <strong>Review contact.</strong> A reviewer wrote to your official contact on{' '}
                {formatDate(profile.reviewContactedAt)}.
                {profile.reviewResponseDueAt
                  ? ` You have until ${formatDate(profile.reviewResponseDueAt)} to answer.`
                  : ''}
                {' '}The account cannot be returned to a personal profile before that date.
              </p>

              {profile.reviewRespondedAt ? (
                <>
                  <p className="settings-business-alert">
                    <CheckIcon size={14} /> Response sent on {formatDate(profile.reviewRespondedAt)}.
                    The review team reads it before deciding.
                  </p>
                  {profile.reviewResponseNote && (
                    <p className="settings-business-quote">{profile.reviewResponseNote}</p>
                  )}
                </>
              ) : (
                <form onSubmit={respondToReview}>
                  <label className="form-group" htmlFor="business-review-response">
                    <span className="form-label">Your response</span>
                    <textarea
                      id="business-review-response"
                      className="form-input"
                      rows={3}
                      maxLength={1000}
                      value={reviewResponse}
                      onChange={(event) => setReviewResponse(event.target.value.slice(0, 1000))}
                      placeholder="Explain the evidence, add context, or link a public page."
                    />
                    <span className="settings-help">
                      At least 10 characters. This is stored with the review so the decision-maker sees it.
                    </span>
                  </label>
                  <div className="settings-actions">
                    <button
                      type="submit"
                      className="btn btn-primary btn-sm"
                      disabled={busy === 'respond' || reviewResponse.trim().length < 10}
                    >
                      {busy === 'respond' ? 'Sending...' : 'Send response'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

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
                disabled={
                  busy === 'manual'
                  || dirty
                  || !hasContactRoute
                  || !(form.proofUrl.trim() || form.proofNote.trim())
                }
                title={dirty ? 'Save the profile before requesting review.' : undefined}
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
