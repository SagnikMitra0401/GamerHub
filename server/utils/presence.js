/**
 * Public projection of a user's presence.
 *
 * 'invisible' is stored on the account so the owner knows their own choice, but
 * everyone else must see them as offline. Apply this before serialising a user
 * (profile, member list, chat sidebar) — never return the raw field.
 */
function publicPresence(presence) {
  if (!presence) return { status: 'offline', activeGame: '' };
  if (presence.status === 'invisible') return { status: 'offline', activeGame: '' };
  return {
    status: presence.status || 'offline',
    activeGame: presence.activeGame || ''
  };
}

module.exports = { publicPresence };
