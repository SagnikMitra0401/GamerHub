import React, { useState } from 'react';
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
import './index.css';

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
        <div className="hero-glow" />
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
