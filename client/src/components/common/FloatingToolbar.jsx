import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { HomeIcon, SearchIcon, ServerIcon, PlusIcon } from './icons';

const FloatingToolbar = ({ onSearchOpen, onCreateOpen }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Only render for authenticated users
  if (!user) return null;

  const level   = user.level || 1;
  const initial = (user.username?.[0] || '?').toUpperCase();

  const isActive = (path) => location.pathname === path;
  const isProfileActive = location.pathname === `/u/${user.username}`;

  return (
    <nav className="floating-toolbar" aria-label="Main Navigation">
      <button
        className={`floating-toolbar-btn toolbar-hide-mobile${isActive('/') ? ' active' : ''}`}
        onClick={() => navigate('/')}
        title="Home Feed"
        aria-label="Home"
      >
        <HomeIcon className="toolbar-icon" size={19} />
        <span className="toolbar-label">Home</span>
      </button>

      <button
        className="floating-toolbar-btn"
        onClick={onSearchOpen}
        title="Search Gamers, Posts & Channels"
        aria-label="Search"
      >
        <SearchIcon className="toolbar-icon" size={19} />
        <span className="toolbar-label">Search</span>
      </button>

      <button
        className={`floating-toolbar-btn toolbar-hide-mobile${isActive('/communities') || location.pathname.startsWith('/communities/') ? ' active' : ''}`}
        onClick={() => navigate('/communities')}
        title="Squads & Communities"
        aria-label="Communities"
      >
        <ServerIcon className="toolbar-icon" size={19} />
        <span className="toolbar-label">Squads</span>
      </button>

      <button
        className="floating-toolbar-btn primary"
        onClick={() => {
          if (onCreateOpen) onCreateOpen();
          else navigate('/?create=1');
        }}
        title="Create New Post"
        aria-label="Create Post"
      >
        <PlusIcon className="toolbar-icon" size={19} />
        <span className="toolbar-label">Post</span>
      </button>

      <button
        className={`floating-toolbar-btn toolbar-hide-mobile${isProfileActive ? ' active' : ''}`}
        onClick={() => navigate(`/u/${user.username}`)}
        title={`Your Profile — Level ${level}`}
        aria-label="Profile"
      >
        <div className="toolbar-avatar-wrap">
          <div className="toolbar-avatar">{initial}</div>
          <span className="toolbar-level-badge">Lv{level}</span>
        </div>
        <span className="toolbar-label">Profile</span>
      </button>
    </nav>
  );
};

export default FloatingToolbar;
