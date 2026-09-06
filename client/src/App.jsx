import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
import './index.css';

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
          <Route path="/"            element={<Feed />} />
          <Route path="/posts/:id"   element={<PostDetail />} />
          <Route path="/login"       element={<Login />} />
          <Route path="/register"    element={<Register />} />
          <Route path="/u/:username" element={<ProfilePage />} />
          <Route path="/c/:tag"      element={<ChannelPage />} />
          <Route path="*"            element={<Navigate to="/" replace />} />
        </Routes>
        <FloatingToolbar
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
