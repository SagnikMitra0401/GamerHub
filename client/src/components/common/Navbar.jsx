import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import NotificationBell from './NotificationBell';
import PresencePill from './PresencePill';
import { MenuIcon, CloseIcon, SettingsIcon, MailIcon } from './icons';
import useDmSummary from '../../hooks/useDmSummary';

const NAV_ITEMS = [
  { to: '/', label: 'Feed', icon: 'home', end: true },
  { to: '/communities', label: 'Servers', icon: 'servers' },
  { to: '/lfg', label: 'LFG', icon: 'target' },
  { to: '/games', label: 'Games', icon: 'gamepad' }
];

const PATHS = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V21h13V9.5" /></>,
  servers: <><rect x="3.5" y="4" width="17" height="6" rx="2" /><rect x="3.5" y="14" width="17" height="6" rx="2" /><path d="M7 7h.01M7 17h.01" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
  gamepad: <><rect x="2.5" y="7" width="19" height="10" rx="5" /><path d="M7 10v4M5 12h4" /><circle cx="16" cy="11" r="0.9" fill="currentColor" stroke="none" /><circle cx="18.5" cy="13.5" r="0.9" fill="currentColor" stroke="none" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.2 8-6.2s8 2.2 8 6.2" /></>,
  admin: <><path d="M12 3l8 3v6c0 5-3.8 8.2-8 9-4.2-.8-8-4-8-9V6z" /><path d="m9 12 2 2 4-4" /></>
};

const Glyph = ({ name, className = 'glyph' }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {PATHS[name] || PATHS.home}
  </svg>
);

const navClass = ({ isActive }) => `navbar-link${isActive ? ' active' : ''}`;
const drawerClass = ({ isActive }) => `drawer-link${isActive ? ' active' : ''}`;
const dockClass = ({ isActive }) => `dock-item${isActive ? ' active' : ''}`;

const Navbar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const dmCounts = useDmSummary();
  const dmTotal = (dmCounts.requests || 0) + (dmCounts.unread || 0);

  // A route change should never leave the drawer hanging over the new page.
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  // Resizing past the compact breakpoint makes the drawer meaningless.
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 861px)');
    const onChange = (event) => { if (event.matches) setDrawerOpen(false); };
    desktop.addEventListener('change', onChange);
    return () => desktop.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [drawerOpen]);

  const handleLogout = async () => {
    setDrawerOpen(false);
    await logout();
    navigate('/login');
  };

  const items = user?.role === 'admin'
    ? [...NAV_ITEMS, { to: '/admin', label: 'Admin', icon: 'admin' }]
    : NAV_ITEMS;

  const initial = (user?.username?.[0] || '?').toUpperCase();

  return (
    <>
      <nav className="navbar">
        <div className="container navbar-inner">
          <Link to="/" className="navbar-logo" aria-label="GamingHub home">
            <Glyph name="gamepad" className="navbar-logo-mark" />
            <span className="navbar-logo-text">GamingHub</span>
          </Link>

          <div className="navbar-links">
            {items.map(item => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
                <Glyph name={item.icon} className="nav-link-icon" />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>

          <div className="navbar-actions">
            {user ? (
              <>
                <PresencePill />
                <Link
                  to="/messages"
                  className={`navbar-icon-btn${pathname.startsWith('/messages') ? ' is-active' : ''}`}
                  aria-label={`Messages${dmTotal > 0 ? `, ${dmTotal} waiting` : ''}`}
                  title="Messages"
                >
                  <MailIcon size={17} />
                  {dmTotal > 0 && (
                    <span className="navbar-icon-badge">{dmTotal > 9 ? '9+' : dmTotal}</span>
                  )}
                </Link>
                <NotificationBell />
                <Link
                  to="/settings"
                  className={`navbar-icon-btn${pathname.startsWith('/settings') ? ' is-active' : ''}`}
                  aria-label="Account settings"
                  title="Account settings"
                >
                  <SettingsIcon size={17} />
                </Link>
                <Link to={`/u/${user.username}`} className="navbar-username">{user.username}</Link>
                <button className="btn btn-ghost btn-sm navbar-logout" onClick={handleLogout}>Log out</button>
              </>
            ) : (
              <>
                <Link to="/login" className="btn btn-ghost btn-sm">Log in</Link>
                <Link to="/register" className="btn btn-primary btn-sm">Join</Link>
              </>
            )}

            <button
              type="button"
              className="navbar-menu-btn"
              aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(v => !v)}
            >
              {drawerOpen ? <CloseIcon size={20} /> : <MenuIcon size={20} />}
            </button>
          </div>
        </div>
      </nav>

      {drawerOpen && (
        <button
          type="button"
          className="nav-scrim"
          aria-label="Close menu"
          tabIndex={-1}
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <aside
        className={`nav-drawer${drawerOpen ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        aria-hidden={!drawerOpen}
      >
        <div className="drawer-head">
          <span className="drawer-brand">GamingHub</span>
          <button
            type="button"
            className="icon-btn drawer-close"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="drawer-section-label">Navigate</div>
        <nav className="drawer-links">
          <NavLink to="/messages" className={drawerClass}>
            <MailIcon size={18} className="drawer-icon" />
            <span>Messages</span>
            {dmTotal > 0 && <span className="drawer-badge">{dmTotal > 9 ? '9+' : dmTotal}</span>}
          </NavLink>
          {items.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end} className={drawerClass}>
              <Glyph name={item.icon} className="drawer-icon" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="drawer-divider" />

        {user ? (
          <>
            <Link to={`/u/${user.username}`} className="drawer-account">
              <span className="drawer-avatar">{initial}</span>
              <span className="drawer-account-text">
                <strong>{user.username}</strong>
                <small>Level {user.level || 1} · View passport</small>
              </span>
            </Link>
            <div className="drawer-actions">
              <Link to="/settings" className="btn btn-ghost btn-sm">Account settings</Link>
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleLogout}>
                Log out
              </button>
            </div>
          </>
        ) : (
          <div className="drawer-actions">
            <Link to="/login" className="btn btn-ghost btn-sm">Log in</Link>
            <Link to="/register" className="btn btn-primary btn-sm">Create account</Link>
          </div>
        )}
      </aside>

      <nav className="bottom-dock" aria-label="Primary navigation">
        {NAV_ITEMS.map(item => (
          <NavLink key={item.to} to={item.to} end={item.end} className={dockClass}>
            <Glyph name={item.icon} className="dock-icon" />
            <span className="dock-label">{item.label}</span>
          </NavLink>
        ))}
        {user ? (
          <NavLink to={`/u/${user.username}`} className={dockClass}>
            <span className="dock-avatar" aria-hidden="true">{initial}</span>
            <span className="dock-label">Profile</span>
          </NavLink>
        ) : (
          <NavLink to="/login" className={dockClass}>
            <Glyph name="user" className="dock-icon" />
            <span className="dock-label">Log in</span>
          </NavLink>
        )}
      </nav>
    </>
  );
};

export default Navbar;
