import { io } from 'socket.io-client';

const RENDER_BACKEND_URL = 'https://gamerhub-backend-3108.onrender.com';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ||
  (import.meta.env.PROD ? RENDER_BACKEND_URL : 'http://localhost:5000');

let socket = null;
let socketToken = null;

/**
 * Connect (or re-use) the Socket.io client.
 * A live socket whose token no longer matches the current session is replaced,
 * otherwise logging in as another user would keep chatting as the previous one.
 *
 * @param {string|null} token - JWT from the auth context (cross-site fallback;
 *                              the httpOnly cookie is used when available)
 */
export function connectSocket(token) {
  const nextToken = token || null;

  if (socket && socketToken !== nextToken) {
    socket.disconnect();
    socket = null;
  }

  if (socket) {
    if (!socket.connected) socket.connect();
    return socket;
  }

  socketToken = nextToken;
  socket = io(SOCKET_URL, {
    auth: nextToken ? { token: nextToken } : {},
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 8,
    reconnectionDelay: 1500
  });

  socket.on('connect', () => {
    console.log('[Socket] Connected:', socket.id);
  });

  socket.on('connect_error', (err) => {
    console.warn('[Socket] Connection error:', err.message);
  });

  socket.on('disconnect', (reason) => {
    console.log('[Socket] Disconnected:', reason);
  });

  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    socketToken = null;
  }
}
