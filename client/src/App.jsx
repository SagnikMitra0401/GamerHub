import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Navbar from './components/common/Navbar';
import FloatingToolbar from './components/common/FloatingToolbar';
import SearchModal from './components/search/SearchModal';
import Feed from './pages/Feed';
import PostDetail from './pages/PostDetail';
import Login from './pages/Login';
import Register from './pages/Register';
import ProfilePage from './pages/ProfilePage';
import ChannelPage from './pages/ChannelPage';
import CommunitiesHome from './pages/CommunitiesHome';
import CommunityPage from './pages/CommunityPage';
import LfgPage from './pages/LfgPage';
import GameCatalog from './pages/GameCatalog';
import AdminDashboard from './pages/AdminDashboard';
import SettingsPage from './pages/SettingsPage';
import PrivateRoute from './components/common/PrivateRoute';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import './index.css';

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
  ['/admin', 'admin'],
  ['/', 'feed']
];

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
        <AtmosphereSync />
        <div className="hero-glow" aria-hidden="true" />
        <Navbar />
        <Routes>
          <Route path="/"                       element={<Feed />} />
          <Route path="/posts/:id"              element={<PostDetail />} />
          <Route path="/login"                  element={<Login />} />
          <Route path="/register"               element={<Register />} />
          <Route path="/u/:username"            element={<ProfilePage />} />
          <Route path="/c/:tag"                 element={<ChannelPage />} />
          <Route path="/communities"            element={<CommunitiesHome />} />
          <Route path="/communities/:slug"      element={<CommunityPage />} />
          <Route path="/lfg"                    element={<LfgPage />} />
          <Route path="/games"                  element={<GameCatalog />} />
          <Route path="/admin"                  element={<AdminDashboard />} />
          <Route path="/settings"               element={<PrivateRoute><SettingsPage /></PrivateRoute>} />
          <Route path="/privacy"                element={<PrivacyPolicy />} />
          <Route path="/terms"                  element={<TermsOfService />} />
          <Route path="*"                       element={<Navigate to="/" replace />} />
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
