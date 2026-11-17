import React, { useEffect, useLayoutEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/common/Navbar';
import FloatingToolbar from './components/common/FloatingToolbar';
import SearchModal from './components/search/SearchModal';
import Feed from './pages/Feed';
import PostDetail from './pages/PostDetail';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import EmailVerificationBanner from './components/auth/EmailVerificationBanner';
import ProfilePage from './pages/ProfilePage';
import ChannelPage from './pages/ChannelPage';
import CommunitiesHome from './pages/CommunitiesHome';
import CommunityPage from './pages/CommunityPage';
import JoinInvite from './pages/JoinInvite';
import LfgPage from './pages/LfgPage';
import GameCatalog from './pages/GameCatalog';
import GameDetail from './pages/GameDetail';
import Welcome from './pages/Welcome';
import Discover from './pages/Discover';
import AdminDashboard from './pages/AdminDashboard';
import SettingsPage from './pages/SettingsPage';
import MessagesPage from './pages/MessagesPage';
import Notifications from './pages/Notifications';
import NotFound from './pages/NotFound';
import PrivateRoute from './components/common/PrivateRoute';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import './index.css';
import './phase10.css';
import './phase11.css';
import './phase13.css';
import './phase14.css';
import './phase15.css';

/**
 * Page atmosphere: one ambient tint per surface, set on <body> so the fixed
 * background layer can cross-fade between sections without repainting the DOM.
 */
const ATMOSPHERES = [
  ['/communities', 'community'],
  ['/lfg', 'lfg'],
  ['/games', 'games'],
  ['/u/', 'passport'],
  ['/settings', 'settings'],
  ['/messages', 'messages'],
  ['/admin', 'admin'],
  ['/', 'feed']
];

/**
 * Every route starts at its own top. Without this, React Router keeps the
 * previous page's scroll offset, so a long feed leaves the next page opened
 * halfway down (and short pages look like a blank window).
 */
const RouteScrollReset = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  }, []);

  useLayoutEffect(() => {
    // index.css enables smooth scrolling; temporarily disable it so a route
    // change is an instant reset rather than an animated journey upward.
    const root = document.documentElement;
    const previous = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    root.style.scrollBehavior = previous;
  }, [pathname]);

  return null;
};

const AtmosphereSync = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    const match = ATMOSPHERES.find(([prefix]) => (
      prefix === '/' ? pathname === '/' : pathname.startsWith(prefix)
    ));
    document.body.dataset.atmosphere = match?.[1] || 'feed';
  }, [pathname]);

  return null;
};

/**
 * The floating toolbar belongs to the social feed. Inside a server the chat
 * composer owns the bottom of the screen, so the toolbar would sit on top of it.
 */
/**
 * New accounts finish game-first onboarding before the rest of the app. The
 * field is only `null` for accounts created after 14B; existing accounts have a
 * timestamp from the migration and are never interrupted.
 */
const ONBOARDING_ALLOWED = [
  '/welcome', '/discover', '/verify-email', '/settings',
  '/login', '/register', '/forgot-password', '/reset-password',
  '/privacy', '/terms'
];

const OnboardingGate = () => {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || !user || user.onboardingCompletedAt !== null) return;
    const allowed = pathname.startsWith('/join/')
      || ONBOARDING_ALLOWED.some((path) => pathname === path || pathname.startsWith(`${path}/`));
    if (!allowed) navigate('/welcome', { replace: true });
  }, [user, loading, pathname, navigate]);

  return null;
};

const GlobalToolbar = ({ onSearchOpen, onCreateOpen }) => {
  const { pathname } = useLocation();
  if (/^\/communities\/[^/]+/.test(pathname)) return null;
  return <FloatingToolbar onSearchOpen={onSearchOpen} onCreateOpen={onCreateOpen} />;
};

function App() {
  const [searchOpen, setSearchOpen] = useState(false);

  const handleCreateOpen = () => {
    // Navigate to feed with ?create=1 param to auto-open post form
    window.location.href = '/?create=1';
  };

  return (
    <BrowserRouter>
      <AuthProvider>
        <RouteScrollReset />
        <AtmosphereSync />
        <OnboardingGate />
        <div className="hero-glow" aria-hidden="true" />
        <Navbar />
        <EmailVerificationBanner />
        <Routes>
          <Route path="/"                       element={<Feed />} />
          <Route path="/posts/:id"              element={<PostDetail />} />
          <Route path="/login"                  element={<Login />} />
          <Route path="/register"               element={<Register />} />
          <Route path="/forgot-password"        element={<ForgotPassword />} />
          <Route path="/reset-password"         element={<ResetPassword />} />
          <Route path="/verify-email"           element={<VerifyEmail />} />
          <Route path="/u/:username"            element={<ProfilePage />} />
          <Route path="/c/:tag"                 element={<ChannelPage />} />
          <Route path="/communities"            element={<CommunitiesHome />} />
          <Route path="/communities/:slug"      element={<CommunityPage />} />
          <Route path="/join/:code"             element={<JoinInvite />} />
          <Route path="/lfg"                    element={<LfgPage />} />
          <Route path="/games"                  element={<GameCatalog />} />
          <Route path="/games/:slug"            element={<GameDetail />} />
          <Route path="/welcome"                element={<PrivateRoute><Welcome /></PrivateRoute>} />
          <Route path="/discover"               element={<PrivateRoute><Discover /></PrivateRoute>} />
          <Route path="/admin"                  element={<AdminDashboard />} />
          <Route path="/settings"               element={<PrivateRoute><SettingsPage /></PrivateRoute>} />
          <Route path="/messages"               element={<PrivateRoute><MessagesPage /></PrivateRoute>} />
          <Route path="/notifications"          element={<PrivateRoute><Notifications /></PrivateRoute>} />
          <Route path="/privacy"                element={<PrivacyPolicy />} />
          <Route path="/terms"                  element={<TermsOfService />} />
          {/* A wrong URL shows a real 404 instead of redirecting: a silent
              redirect makes a broken link look like a working one. */}
          <Route path="*"                       element={<NotFound />} />
        </Routes>
        <GlobalToolbar
          onSearchOpen={() => setSearchOpen(true)}
          onCreateOpen={handleCreateOpen}
        />
        <SearchModal
          isOpen={searchOpen}
          onClose={() => setSearchOpen(false)}
        />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
