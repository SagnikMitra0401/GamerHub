import { useCallback, useEffect, useState } from 'react';
import axiosInstance from '../api/axiosInstance';
import { connectSocket } from '../api/socket';
import { useAuth } from '../context/AuthContext';

const EMPTY = { requests: 0, unread: 0, inbox: 0 };

/**
 * Small, shared inbox counter for the navbar. The messages page owns the full
 * list; this hook only listens to the events that change the badge, so a tab
 * sitting on the feed still learns about a new message without polling.
 */
export default function useDmSummary() {
  const { user, token } = useAuth();
  const [counts, setCounts] = useState(EMPTY);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await axiosInstance.get('/messages/summary');
      setCounts({
        requests: Number(data?.requests) || 0,
        unread: Number(data?.unread) || 0,
        inbox: Number(data?.inbox) || 0
      });
    } catch {
      // A badge is not worth surfacing an error for; the next event retries.
    }
  }, [user?._id]);

  useEffect(() => {
    if (!user) {
      setCounts(EMPTY);
      return undefined;
    }

    refresh();
    const socket = connectSocket(token);
    const onChange = () => refresh();
    const events = ['dm_message', 'dm_accepted', 'dm_declined', 'dm_read'];
    events.forEach((event) => socket.on(event, onChange));

    return () => {
      events.forEach((event) => socket.off(event, onChange));
    };
  }, [user?._id, token, refresh]);

  return counts;
}
