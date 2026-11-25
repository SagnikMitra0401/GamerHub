import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import axiosInstance from '../../api/axiosInstance';

const FollowButton = ({ username, initialFollowing, onToggle }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [following, setFollowing] = useState(initialFollowing);
  const [loading, setLoading] = useState(false);

  if (user?.username === username) return null; // don't show on own profile

  const handleClick = async () => {
    if (!user) return navigate('/login');
    if (loading) return;
    setLoading(true);
    try {
      const { data } = await axiosInstance.post(`/users/${username}/follow`);
      setFollowing(data.following);
      onToggle?.(data);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      className={`btn btn-sm ${following ? 'btn-ghost' : 'btn-primary'}`}
      onClick={handleClick}
      disabled={loading}
    >
      {following ? 'Unfollow' : '+ Follow'}
    </button>
  );
};

export default FollowButton;
