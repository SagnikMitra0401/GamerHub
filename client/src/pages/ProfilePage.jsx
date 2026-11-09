import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import axiosInstance from '../api/axiosInstance';
import PostList from '../components/posts/PostList';
import FollowButton from '../components/common/FollowButton';
import GamerPassportCard from '../components/profile/GamerPassportCard';
import EditPassportModal from '../components/profile/EditPassportModal';
import { ROLE_LABELS } from '../utils/permissions';
import { BriefcaseIcon, FilmIcon, CommentIcon, FlameIcon, UsersIcon, CloseIcon, LinkIcon, MailIcon } from '../components/common/icons';
import CommunitySigil from '../components/communities/CommunitySigil';
import InvitationInbox from '../components/invitations/InvitationInbox';
import MessageRequestModal from '../components/messages/MessageRequestModal';
import { PostListSkeleton, ProfileSkeleton } from '../components/common/Skeleton';

const ProfilePage = () => {
  const { username } = useParams();
  const { user: me, updateUser } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile]               = useState(null);
  const [posts, setPosts]                   = useState([]);
  const [savedPosts, setSavedPosts]         = useState([]);
  const [tab, setTab]                       = useState('posts'); // 'posts' | 'saved'
  const [loading, setLoading]               = useState(true);
  const [postsLoading, setPostsLoading]     = useState(false);
  const [activeModal, setActiveModal]       = useState(null); // 'followers' | 'following' | null
  const [passportModalOpen, setPassportModalOpen] = useState(false);
  const [invitesOpen, setInvitesOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);

  const isOwnProfile = me?.username === username;
  const isBlocked = Boolean(
    me && profile && (me.blockedUsers || []).some(id => String(id) === String(profile._id))
  );

  const toggleBlock = async () => {
    if (!profile) return;
    try {
      const path = `/account/block/${profile._id}`;
      if (isBlocked) await axiosInstance.delete(path);
      else await axiosInstance.post(path);

      const current = (me.blockedUsers || []).map(String);
      updateUser({
        blockedUsers: isBlocked
          ? current.filter(id => id !== String(profile._id))
          : [...current, String(profile._id)]
      });
    } catch (err) {
      window.alert(err.response?.data?.message || 'Could not update that block.');
    }
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data } = await axiosInstance.get(`/users/${username}`);
        setProfile(data);
      } catch {
        navigate('/');
      } finally {
        setLoading(false);
      }
    };
    load();
    setTab('posts');
    setActiveModal(null);
    setDmOpen(false);
  }, [username]);

  useEffect(() => {
    if (!profile) return;
    if (tab === 'posts') {
      setPostsLoading(true);
      axiosInstance.get(`/users/${username}/posts`)
        .then(({ data }) => setPosts(Array.isArray(data) ? data : []))
        .catch(() => {})
        .finally(() => setPostsLoading(false));
    } else if (tab === 'saved' && isOwnProfile) {
      setPostsLoading(true);
      axiosInstance.get('/users/me/saved')
        .then(({ data }) => setSavedPosts(Array.isArray(data) ? data : []))
        .catch(() => {})
        .finally(() => setPostsLoading(false));
    }
  }, [tab, profile]);

  const handleFollowToggle = ({ followers }) => {
    setProfile(prev => prev ? { ...prev, followers } : prev);
  };

  const handleDelete = id => {
    setPosts(prev => prev.filter(p => p._id !== id));
    setSavedPosts(prev => prev.filter(p => p._id !== id));
  };

  const handleUserClick = (targetUsername) => {
    setActiveModal(null);
    navigate(`/u/${targetUsername}`);
  };

  const handlePassportSave = (updatedPassport) => {
    setProfile(prev => prev ? { ...prev, gamerPassport: updatedPassport } : prev);
  };

  if (loading) {
    return (
      <div className="page">
        <div className="container"><ProfileSkeleton /></div>
      </div>
    );
  }
  if (!profile) return null;

  const joinedDate = new Date(profile.createdAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long'
  });

  const followersList = profile.followers || [];
  const followingList = profile.following || [];

  return (
    <main className="page">
      <div className="container profile-container" style={{ paddingTop: '1.5rem', paddingBottom: '4rem' }}>
        <div className="profile-layout-grid">
          
          {/* Left Column: Gamer Passport & Multi-Rig Showcase */}
          <aside className="profile-left-col">
            <GamerPassportCard
              passport={profile.gamerPassport}
              username={profile.username}
              isOwnProfile={isOwnProfile}
              onEditClick={() => setPassportModalOpen(true)}
            />
          </aside>

          {/* Right Column: Profile Header, Medals & Posts */}
          <section className="profile-main-col">
            {/* Profile Card */}
            <div className="card" style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.25rem', flexWrap: 'wrap' }}>

                {/* Avatar */}
                <div className="post-avatar" style={{ width: 64, height: 64, fontSize: '1.5rem', flexShrink: 0 }}>
                  {profile.username[0].toUpperCase()}
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                    <h1 style={{ fontSize: '1.4rem', fontWeight: 800 }}>{profile.username}</h1>
                    
                    {/* Role Badge */}
                    {profile.role === 'admin' && <span className="role-badge admin">Admin</span>}
                    {profile.role === 'moderator' && <span className="role-badge mod">Mod</span>}
                    {(!profile.role || profile.role === 'user') && <span className="role-badge user">Gamer</span>}
                    {profile.profileType === 'creator_business' && (
                      <span className="role-badge business">Business</span>
                    )}

                    <FollowButton
                      username={profile.username}
                      initialFollowing={profile.isFollowing}
                      onToggle={handleFollowToggle}
                    />

                    {!isOwnProfile && me && !isBlocked && profile.dm?.allowed !== false && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm profile-message-btn"
                        onClick={() => setDmOpen(true)}
                        title={profile.dm?.label || 'Send a private message'}
                      >
                        <MailIcon size={14} /> Message
                      </button>
                    )}

                    {!isOwnProfile && profile.dm?.allowed === false && (
                      <span className="profile-dm-closed" title={profile.dm?.label}>
                        {profile.dm?.mode === 'paused' ? 'Inbox paused' : 'Not accepting messages'}
                      </span>
                    )}

                    {!isOwnProfile && me && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={toggleBlock}>
                        {isBlocked ? 'Unblock' : 'Block'}
                      </button>
                    )}

                    {isOwnProfile && (
                      <span className="profile-own-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setInvitesOpen(true)}
                        >
                          Invitations
                        </button>
                        <Link to="/settings" className="btn btn-ghost btn-sm">
                          Settings
                        </Link>
                      </span>
                    )}
                  </div>

                  <p className="text-muted" style={{ marginBottom: '0.75rem' }}>
                    Joined {joinedDate}
                  </p>

                  {/* XP & Level Progress Engine */}
                  <div className="profile-xp-section" style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--primary-light)' }}>
                        Level {profile.level || 1}
                      </span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {(profile.xp || 0) % 25}/25 XP ({profile.xp || 0} Total XP)
                      </span>
                    </div>
                    <div className="xp-bar-track">
                      <div 
                        className="xp-bar-fill" 
                        style={{ width: `${Math.min(100, (((profile.xp || 0) % 25) / 25) * 100)}%` }} 
                      />
                    </div>
                  </div>

                  {/* Medals Showcase */}
                  <div style={{ marginBottom: '1rem' }}>
                    <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                      Achievement Medals ({profile.medals?.length || 0}/4)
                    </h4>
                    <div className="medals-grid">
                      {[
                        { id: 'highlight_poster', name: 'Highlight Poster', icon: <FilmIcon size={22} />, desc: 'Uploaded 1st gaming clip/screenshot' },
                        { id: 'gamer_critic',     name: 'Gamer Critic',     icon: <CommentIcon size={22} />, desc: 'Posted 1st community comment' },
                        { id: 'viral_gamer',      name: 'Viral Gamer',      icon: <FlameIcon size={22} />, desc: 'Post reached 10 likes' },
                        { id: 'community_builder',name: 'Community Builder',icon: <UsersIcon size={22} />, desc: 'Followed 5+ gamers' }
                      ].map(m => {
                        const earned = (profile.medals || []).find(x => x.id === m.id);
                        return (
                          <div 
                            key={m.id} 
                            className={`medal-badge-card${earned ? ' unlocked' : ' locked'}`}
                            title={earned ? `Unlocked: ${m.name} - ${m.desc}` : `Locked: ${m.name} - ${m.desc}`}
                          >
                            <span className="medal-icon">{m.icon}</span>
                            <div className="medal-text">
                              <span className="medal-name">{m.name}</span>
                              <span className="medal-desc">{m.desc}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {profile.bio && (
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '0.75rem', fontSize: '0.95rem' }}>
                      {profile.bio}
                    </p>
                  )}

                  {profile.business && (
                    <section className="profile-business-card" aria-label="Business profile">
                      <div className="profile-business-head">
                        <span className="profile-business-icon" aria-hidden="true">
                          <BriefcaseIcon size={17} />
                        </span>
                        <div>
                          <span className="profile-business-kicker">Business profile</span>
                          <strong>{profile.business.displayName}</strong>
                        </div>
                        <span className={`business-verification${profile.business.verificationStatus === 'verified' ? ' is-verified' : ''}`}>
                          {profile.business.verificationStatus === 'verified' ? 'Verified business' : 'Unverified'}
                        </span>
                      </div>
                      {profile.business.description && (
                        <p>{profile.business.description}</p>
                      )}
                      <div className="profile-business-meta">
                        {profile.business.category && <span>{profile.business.category}</span>}
                        {profile.business.responseExpectation && <span>{profile.business.responseExpectation}</span>}
                        {profile.business.timezone && <span>{profile.business.timezone}</span>}
                      </div>
                      {(profile.business.website || profile.business.supportEmail) && (
                        <div className="profile-business-links">
                          {profile.business.website && (
                            <a href={profile.business.website} target="_blank" rel="noreferrer noopener">
                              <LinkIcon size={12} /> {profile.business.website.replace(/^https:\/\//, '')}
                            </a>
                          )}
                          {profile.business.supportEmail && (
                            <a href={`mailto:${profile.business.supportEmail}`}>
                              <MailIcon size={12} /> {profile.business.supportEmail}
                            </a>
                          )}
                        </div>
                      )}
                      {profile.business.links?.length > 0 && (
                        <div className="profile-business-links">
                          {profile.business.links.map((link) => (
                            <a key={link} href={link} target="_blank" rel="noreferrer noopener">
                              <LinkIcon size={12} /> {link.replace(/^https:\/\//, '')}
                            </a>
                          ))}
                        </div>
                      )}
                    </section>
                  )}

                  {!isOwnProfile && profile.dm?.availability === 'away' && profile.dm?.awayMessage && (
                    <p className="profile-dm-away">{profile.dm.awayMessage}</p>
                  )}

                  {/* Server memberships + the role held in each */}
                  {profile.communities?.length > 0 && (
                    <div style={{ marginBottom: '1rem' }}>
                      <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: '0.45rem' }}>
                        Servers
                      </h4>
                      <div className="server-chip-row">
                        {profile.communities.map(server => (
                          <Link
                            key={server._id}
                            to={`/communities/${server.slug}`}
                            className="server-chip"
                            title={`${server.name} — ${ROLE_LABELS[server.role] || server.role}`}
                          >
                            <CommunitySigil name={server.name} icon={server.icon} size={18} />
                            <span>{server.name}</span>
                            {server.role !== 'member' && (
                              <span className="server-role">{ROLE_LABELS[server.role]}</span>
                            )}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Stats */}
                  <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                    <span className="post-stat" style={{ userSelect: 'none' }}>
                      {profile.postCount ?? 0} Posts
                    </span>
                    
                    <span 
                      className="post-stat" 
                      onClick={() => setActiveModal('followers')} 
                      style={{ cursor: 'pointer', transition: 'color 0.2s' }}
                      onMouseEnter={e => e.target.style.color = 'var(--primary-light)'}
                      onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}
                      title="View followers"
                    >
                      {followersList.length} Followers
                    </span>

                    <span 
                      className="post-stat" 
                      onClick={() => setActiveModal('following')} 
                      style={{ cursor: 'pointer', transition: 'color 0.2s' }}
                      onMouseEnter={e => e.target.style.color = 'var(--primary-light)'}
                      onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}
                      title="View following list"
                    >
                      {followingList.length} Following
                    </span>
                  </div>

                  {/* Platforms */}
                  {profile.preferredPlatforms?.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      {profile.preferredPlatforms.map(p => (
                        <span key={p} className="tag">
                          {p}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="sort-tabs" style={{ marginBottom: '1.25rem', display: 'inline-flex' }}>
              <button
                className={`sort-tab ${tab === 'posts' ? 'active' : ''}`}
                onClick={() => setTab('posts')}
              >
                Posts
              </button>
              {isOwnProfile && (
                <button
                  className={`sort-tab ${tab === 'saved' ? 'active' : ''}`}
                  onClick={() => setTab('saved')}
                >
                  Saved
                </button>
              )}
            </div>

            {postsLoading ? (
              <PostListSkeleton count={2} />
            ) : (
              <PostList
                posts={tab === 'saved' ? savedPosts : posts}
                onDelete={handleDelete}
              />
            )}
          </section>
        </div>
      </div>

      {/* Follower / Following List Modal */}
      {activeModal && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '360px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 className="modal-title" style={{ margin: 0, textTransform: 'capitalize' }}>
                {activeModal}
              </h2>
              <button 
                onClick={() => setActiveModal(null)} 
                aria-label={`Close ${activeModal} list`}
                style={{ 
                  background: 'transparent', 
                  border: 'none', 
                  color: 'var(--text-secondary)', 
                  cursor: 'pointer', 
                  display: 'flex', 
                  alignItems: 'center' 
                }}
              >
                <CloseIcon size={16} />
              </button>
            </div>

            <div style={{ maxHeight: '280px', overflowY: 'auto', paddingRight: '0.25rem' }}>
              {((activeModal === 'followers' ? followersList : followingList)).length === 0 ? (
                <p className="text-muted" style={{ textAlign: 'center', padding: '2rem 0' }}>
                  No users to show.
                </p>
              ) : (
                ((activeModal === 'followers' ? followersList : followingList)).map(u => (
                  <div 
                    key={u._id} 
                    onClick={() => handleUserClick(u.username)}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.75rem', 
                      padding: '0.65rem 0.5rem', 
                      cursor: 'pointer',
                      borderRadius: 'var(--radius-sm)',
                      transition: 'background 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div className="post-avatar" style={{ width: 28, height: 28, fontSize: '0.75rem' }}>
                      {u.username[0].toUpperCase()}
                    </div>
                    <span style={{ fontWeight: 600, fontSize: '0.92rem' }}>
                      {u.username}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Gamer Passport Modal */}
      <EditPassportModal
        isOpen={passportModalOpen}
        onClose={() => setPassportModalOpen(false)}
        initialPassport={profile.gamerPassport}
        onSave={handlePassportSave}
      />

      {isOwnProfile && (
        <InvitationInbox
          isOpen={invitesOpen}
          onClose={() => setInvitesOpen(false)}
          onAccepted={() => navigate('/lfg')}
        />
      )}

      {!isOwnProfile && me && (
        <MessageRequestModal
          open={dmOpen}
          profile={profile}
          onClose={() => setDmOpen(false)}
        />
      )}
    </main>
  );
};

export default ProfilePage;
