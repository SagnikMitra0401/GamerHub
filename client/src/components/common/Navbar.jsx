import React from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import NotificationBell from './NotificationBell';
import PresencePill from './PresencePill';

const navClass = ({ isActive }) => `navbar-link${isActive ? ' active' : ''}`;

const Navbar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <nav className="navbar">
      <div className="container">
        <Link to="/" className="navbar-logo">⚔ GamingHub</Link>
        <div className="navbar-links">
          <NavLink to="/" end className={navClass}>Feed</NavLink>
          <NavLink to="/communities" className={navClass}>🏰 Servers</NavLink>
          <NavLink to="/lfg" className={navClass}>🎯 LFG</NavLink>
          <NavLink to="/games" className={navClass}>🎮 Games</NavLink>
          {user?.role === 'admin' && (
            <NavLink to="/admin" className={navClass}>🛡️ Admin</NavLink>
          )}
        </div>
        <div className="navbar-actions">
          {user ? (
            <>
              <PresencePill />
              <NotificationBell />
              <Link to={`/u/${user.username}`} className="navbar-username">{user.username}</Link>
              <button className="btn btn-ghost btn-sm" onClick={handleLogout}>Logout</button>
            </>
          ) : (
            <>
              <Link to="/login"    className="btn btn-ghost btn-sm">Login</Link>
              <Link to="/register" className="btn btn-primary btn-sm">Join</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
