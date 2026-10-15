import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axiosInstance from '../api/axiosInstance';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser]       = useState(null);
  const [token, setToken]     = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get('/auth/me');
      setUser(data.user);
      if (data.token) setToken(data.token);
    } catch {
      setUser(null);
      setToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMe(); }, [fetchMe]);

  const login = async (email, password) => {
    const { data } = await axiosInstance.post('/auth/login', { email, password });
    if (data.token) setToken(data.token);
    await fetchMe(); // re-fetch full profile so savedPosts/favoriteChannels are included
  };

  const register = async (username, email, password) => {
    const { data } = await axiosInstance.post('/auth/register', { username, email, password });
    if (data.token) setToken(data.token);
    await fetchMe();
  };

  const logout = async () => {
    await axiosInstance.post('/auth/logout');
    setUser(null);
    setToken(null);
  };

  // Locally update user's favoriteChannels after a toggle (avoids re-fetch)
  const updateFavouriteChannels = (channels) => {
    setUser(prev => prev ? { ...prev, favoriteChannels: channels } : prev);
  };

  // Locally update savedPosts after a bookmark toggle
  const updateSavedPosts = (postId, saved) => {
    setUser(prev => {
      if (!prev) return prev;
      const savedPosts = saved
        ? [...(prev.savedPosts || []), postId]
        : (prev.savedPosts || []).filter(id => id !== postId && id?.toString() !== postId);
      return { ...prev, savedPosts };
    });
  };

  return (
    <AuthContext.Provider value={{
      user, token, loading, login, register, logout, fetchMe,
      updateFavouriteChannels, updateSavedPosts
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
