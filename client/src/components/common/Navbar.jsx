import React from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

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
          <NavLink
            to="/"
            end
            className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}
          >
            Feed
          </NavLink>
          <NavLink
            to="/communities"
            className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}
          >
            🏰 Servers
          </NavLink>
        </div>
        <div className="navbar-actions">
          {user ? (
            <>
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
