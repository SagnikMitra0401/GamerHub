import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axiosInstance from '../api/axiosInstance';
import { disconnectSocket } from '../api/socket';

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
      return data.user;
    } catch {
      setUser(null);
      setToken(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMe(); }, [fetchMe]);

  const login = async (email, password) => {
    const { data } = await axiosInstance.post('/auth/login', { email, password });
    if (data.token) setToken(data.token);
    await fetchMe(); // full profile (savedPosts/favoriteChannels)
  };

  const register = async (username, email, password, preferredPlatforms = []) => {
    const { data } = await axiosInstance.post('/auth/register', {
      username,
      email,
      password,
      preferredPlatforms
    });
    if (data.token) setToken(data.token);
    await fetchMe();
  };

  const logout = async () => {
    try {
      await axiosInstance.post('/auth/logout');
    } catch {
      // Clearing local state is what matters; ignore network failures.
    } finally {
      disconnectSocket();
      setUser(null);
      setToken(null);
    }
  };

  const updateFavouriteChannels = (channels) => {
    setUser(prev => prev ? { ...prev, favoriteChannels: channels } : prev);
  };

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
