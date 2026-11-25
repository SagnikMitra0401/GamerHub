/**
 * socket.io does not know about the account attached to a connection.
 *
 * `config/socket.js` resolves the cookie-token identity once in the handshake
 * middleware and stores it on the socket. Every handler then reads it. This
 * declaration tells the type checker what the handshake puts there, so it is
 * null for an anonymous socket and the trimmed user row otherwise.
 */
import 'socket.io';

declare module 'socket.io' {
  interface Socket {
    user: {
      _id: any;
      username: string;
      level?: number;
      role?: string;
      status?: string;
      sessionVersion?: number;
    } | null;
  }
}
