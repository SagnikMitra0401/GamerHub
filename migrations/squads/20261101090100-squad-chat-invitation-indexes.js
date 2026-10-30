/**
 * Squad domain: the 15-day temporary chat and the consent-driven invitation
 * ledger.
 *
 * `squadchats.squadId` is unique — a squad has exactly one chat, so a race
 * between two "lock" calls cannot create a second thread. The TTL sweep reads
 * `{ state, expiresAt }`, which is the index the retention worker uses.
 */
module.exports = {
  async up(db) {
    const chats = db.collection('squadchats');
    await chats.createIndex({ squadId: 1 }, { unique: true, background: true, name: 'squadchat_squad_unique' });
    await chats.createIndex({ state: 1, expiresAt: 1 }, { background: true, name: 'squadchat_state_expires' });
    await chats.createIndex({ ownerUserId: 1 }, { background: true, name: 'squadchat_owner' });
    await chats.createIndex({ memberIds: 1 }, { background: true, name: 'squadchat_member' });

    const messages = db.collection('squadchatmessages');
    await messages.createIndex({ chatId: 1, createdAt: -1 }, { background: true, name: 'squadchatmsg_chat_created' });
    await messages.createIndex({ squadId: 1 }, { background: true, name: 'squadchatmsg_squad' });

    const invitations = db.collection('invitations');
    await invitations.createIndex(
      { recipientUserId: 1, status: 1, createdAt: -1 },
      { background: true, name: 'invite_recipient_status' }
    );
    await invitations.createIndex({ inviterUserId: 1 }, { background: true, name: 'invite_inviter' });
    await invitations.createIndex(
      { recipientUserId: 1, targetType: 1, targetId: 1 },
      {
        unique: true,
        background: true,
        name: 'invite_target_pending_unique',
        partialFilterExpression: { status: 'pending' }
      }
    );
    await invitations.createIndex({ expiresAt: 1 }, { background: true, name: 'invite_expires' });
  },

  async down(db) {
    const drops = {
      squadchats: ['squadchat_squad_unique', 'squadchat_state_expires', 'squadchat_owner', 'squadchat_member'],
      squadchatmessages: ['squadchatmsg_chat_created', 'squadchatmsg_squad'],
      invitations: ['invite_recipient_status', 'invite_inviter', 'invite_target_pending_unique', 'invite_expires']
    };
    for (const [collection, names] of Object.entries(drops)) {
      for (const name of names) {
        await db.collection(collection).dropIndex(name).catch(() => {});
      }
    }
  }
};
