import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';
import CommunitySigil from '../components/communities/CommunitySigil';
import { AlertIcon, UsersIcon } from '../components/common/icons';

/**
 * Public landing page for a shared server invite.
 *
 * Anyone with the link sees the server card before signing in, then joins with
 * one click. A private server is normally invisible; holding a valid code is
 * exactly what makes it visible here, and only the public card is shown.
 */
const JoinInvite = () => {
  const { code } = useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [joining, setJoining] = useState(false);
  const [requested, setRequested] = useState(false);
  const [joinError, setJoinError] = useState('');

  const redirectPath = `/join/${code}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    axiosInstance.get(`/communities/invites/${code}`)
      .then(({ data }) => {
        if (cancelled) return;
        setPreview(data);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError({
          status: err.response?.status,
          message: err.response?.data?.message || 'This invite link is not valid.'
        });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [code, user?._id]);

  const join = async () => {
    setJoining(true);
    setJoinError('');
    try {
      const { data } = await axiosInstance.post(`/communities/invites/${code}/join`);
      if (data?.pending) {
        setRequested(true);
        return;
      }
      navigate(`/communities/${data.slug}`, { replace: true });
    } catch (err) {
      setJoinError(err.response?.data?.message || 'Could not join that server.');
    } finally {
      setJoining(false);
    }
  };

  const busy = loading || authLoading;

  return (
    <main className="page">
      <div className="container" style={{ maxWidth: '560px', paddingTop: '2.5rem' }}>
        {busy && !preview && (
          <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
            <p className="text-muted" style={{ margin: 0 }}>Checking invite link…</p>
          </div>
        )}

        {!busy && error && (
          <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
            <span style={{ display: 'inline-flex', color: 'var(--danger, #f87171)' }}>
              <AlertIcon size={26} />
            </span>
            <h1 className="page-title" style={{ fontSize: '1.35rem', margin: '0.75rem 0 0.35rem' }}>
              Invite unavailable
            </h1>
            <p className="text-muted" style={{ marginBottom: '1.25rem' }}>
              {error.message}
            </p>
            <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link to="/communities" className="btn btn-primary btn-sm">Browse public servers</Link>
              <Link to="/" className="btn btn-ghost btn-sm">Back to the feed</Link>
            </div>
          </div>
        )}

        {!busy && !error && preview && (
          <div className="card" style={{ padding: '1.75rem' }}>
            <span className="dm-eyebrow">Server invite</span>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', margin: '0.6rem 0 0.9rem' }}>
              <CommunitySigil
                name={preview.community.name}
                icon={preview.community.icon}
                size={56}
              />
              <div style={{ minWidth: 0 }}>
                <h1 style={{ margin: 0, fontSize: '1.35rem', lineHeight: 1.2, overflowWrap: 'anywhere' }}>
                  {preview.community.name}
                </h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.3rem' }}>
                  <span className="text-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem' }}>
                    <UsersIcon size={13} />
                    {preview.community.memberCount} member{preview.community.memberCount === 1 ? '' : 's'}
                  </span>
                  <span
                    className="community-private-tag"
                    style={preview.community.isPrivate ? undefined : { opacity: 0.85 }}
                  >
                    {preview.community.isPrivate ? 'Invite-only' : 'Public server'}
                  </span>
                </div>
              </div>
            </div>

            {preview.community.description && (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.55, overflowWrap: 'anywhere' }}>
                {preview.community.description}
              </p>
            )}

            <p className="text-muted" style={{ fontSize: '0.78rem', lineHeight: 1.55 }}>
              {preview.community.isPrivate
                ? 'This server is invite-only. A link like this one is the only way in, and the person who shared it can revoke it.'
                : 'This server is public. The link is a shortcut that adds you and opens the chat directly.'}
              {preview.requiresApproval && ' Joining also needs a manager\'s approval.'}
              {preview.expiresAt && ` This link expires ${new Date(preview.expiresAt).toLocaleDateString()}.`}
              {preview.maxUses > 0 && ` It can be used ${Math.max(0, preview.maxUses - preview.uses)} more time${preview.maxUses - preview.uses === 1 ? '' : 's'}.`}
            </p>

            {joinError && (
              <p className="dm-inline-error" role="alert" style={{ marginBottom: '0.75rem' }}>
                <AlertIcon size={13} /> {joinError}
              </p>
            )}

            {preview.alreadyMember ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <p style={{ margin: 0, fontSize: '0.85rem' }}>
                  You are already a member of this server.
                </p>
                <Link to={`/communities/${preview.community.slug}`} className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }}>
                  Open the server
                </Link>
              </div>
            ) : preview.pendingRequest || requested ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <p style={{ margin: 0, fontSize: '0.85rem' }}>
                  <strong>Request pending.</strong> A manager of {preview.community.name} will review
                  your request. You'll get a notification as soon as it is decided.
                </p>
                <Link to="/communities" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }}>
                  Browse other servers
                </Link>
              </div>
            ) : user ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={join}
                  disabled={joining}
                  style={{ alignSelf: 'flex-start' }}
                >
                  {joining
                    ? (preview.requiresApproval ? 'Sending request…' : 'Joining…')
                    : (preview.requiresApproval ? 'Request to join' : `Join ${preview.community.name}`)}
                </button>
                <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                  {preview.requiresApproval
                    ? 'This server reviews requests before adding anyone. You join as a member once approved.'
                    : 'You join as a member. Nothing is posted on your behalf.'}
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <p style={{ margin: 0, fontSize: '0.85rem' }}>
                  Sign in to join the chat — the invite stays attached to this page.
                </p>
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <Link
                    to={`/login?redirect=${encodeURIComponent(redirectPath)}`}
                    className="btn btn-primary btn-sm"
                  >
                    Sign in to join
                  </Link>
                  <Link
                    to={`/register?redirect=${encodeURIComponent(redirectPath)}`}
                    className="btn btn-ghost btn-sm"
                  >
                    Create an account
                  </Link>
                </div>
                <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                  New accounts are free. You can leave the server at any time.
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
};

export default JoinInvite;
