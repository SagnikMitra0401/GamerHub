import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

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
      {/* Home */}
      <button
        className={`floating-toolbar-btn${isActive('/') ? ' active' : ''}`}
        onClick={() => navigate('/')}
        title="Home Feed"
        aria-label="Home"
      >
        <span className="toolbar-icon">🏠</span>
        <span className="toolbar-label">Home</span>
      </button>

      {/* Search */}
      <button
        className="floating-toolbar-btn"
        onClick={onSearchOpen}
        title="Search Gamers, Posts & Channels"
        aria-label="Search"
      >
        <span className="toolbar-icon">🔍</span>
        <span className="toolbar-label">Search</span>
      </button>

      {/* Quick Create — central glowing button */}
      <button
        className="floating-toolbar-btn primary"
        onClick={() => {
          if (onCreateOpen) onCreateOpen();
          else navigate('/?create=1');
        }}
        title="Create New Post"
        aria-label="Create Post"
      >
        <span className="toolbar-icon">➕</span>
        <span className="toolbar-label">Post</span>
      </button>

      {/* Profile with Live Level Badge */}
      <button
        className={`floating-toolbar-btn${isProfileActive ? ' active' : ''}`}
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
