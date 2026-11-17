/**
 * Keep the bell and the full notifications page in sync without introducing a
 * second global store. Detail shapes:
 *   { type: 'read', id, unreadCount }
 *   { type: 'read-all', unreadCount: 0 }
 */
const EVENT = 'gamerhub:notification-state';

export function announceNotificationState(detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail }));
}

export function subscribeNotificationState(handler) {
  if (typeof window === 'undefined') return () => {};
  const listener = (event) => handler(event.detail || {});
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
