import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CompassIcon, GamepadIcon, ServerIcon, UsersIcon } from '../components/common/icons';

/**
 * 404 — "lost signal".
 *
 * A wrong URL should not silently redirect to the feed: that hides broken links
 * and makes a typo look like a fetch failure. This page names what happened,
 * keeps the address visible (so the user can spot the typo) and offers the four
 * surfaces people actually arrive for.
 */

const TRAILS = [
  { to: '/', label: 'Feed', hint: 'What everyone is playing', icon: CompassIcon },
  { to: '/communities', label: 'Servers', hint: 'Find a community', icon: ServerIcon },
  { to: '/lfg', label: 'Squads', hint: 'Looking for group', icon: UsersIcon },
  { to: '/games', label: 'Games', hint: 'Browse the catalog', icon: GamepadIcon }
];

const NotFound = () => {
  const { pathname, search } = useLocation();

  useEffect(() => {
    document.title = 'Page not found · GamingHub';
    return () => { document.title = 'Gaming Hub'; };
  }, []);

  return (
    <main className="nf-page">
      <div className="container">
        <div className="nf-shell">
          <div className="nf-visual" aria-hidden="true">
            <span className="nf-code">404</span>
            <span className="nf-scan" />
          </div>

          <div className="nf-copy">
            <span className="nf-eyebrow">Signal lost</span>
            <h1 className="nf-title">This page is not on the map.</h1>
            <p className="nf-text">
              Nothing is served at <code className="mono">{pathname}{search}</code>.
              The link may be old, mistyped, or the post or server behind it may have been
              removed. Nothing you did caused this, and no data was changed.
            </p>
            <div className="nf-actions">
              <Link className="btn btn-primary" to="/">
                <CompassIcon size={16} /> Back to the feed
              </Link>
              <Link className="btn btn-ghost" to="/communities">
                <ServerIcon size={16} /> Browse servers
              </Link>
            </div>
          </div>

          <nav className="nf-trails" aria-label="Popular destinations">
            {TRAILS.map(({ to, label, hint, icon: Icon }) => (
              <Link key={to} className="nf-trail" to={to}>
                <strong><Icon size={14} /> {label}</strong>
                <small>{hint}</small>
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </main>
  );
};

export default NotFound;
