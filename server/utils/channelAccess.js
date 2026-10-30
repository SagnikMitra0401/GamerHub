/**
 * One place to resolve "can this user touch this channel?".
 *
 * Every channel-scoped endpoint (messages, reactions, pins, search, forums,
 * attachments) goes through here, so the rules cannot drift apart:
 *   1. the channel exists,
 *   2. it belongs to a real community (the community is derived from the
 *      channel, never from the client),
 *   3. the caller holds the capability,
 *   4. the caller passes the channel's role gate.
 */
const mongoose = require('mongoose');

const Channel = require('../models/Channel');
const Community = require('../models/Community');

const { CAP, communityPermissions, roleAtLeast } = require('./permissions');
const { badRequest, forbidden, notFound } = require('./httpError');

const isObjectId = (value) => !!value && mongoose.Types.ObjectId.isValid(String(value));

/**
 * @param {object} input
 * @param {string} input.channelId
 * @param {string} input.userId
 * @param {string} [input.capability] capability required on top of membership
 * @param {'read'|'write'} [input.mode] which role gate to apply
 * @param {boolean} [input.optionalUser] allow anonymous reads (feed-style GETs)
 * @returns {Promise<{channel: object, community: object, role: string|null, permissions: string[]}>}
 */
async function loadChannelAccess({
  channelId,
  userId,
  capability = CAP.VIEW_CHANNEL,
  mode = 'read',
  optionalUser = false
} = {}) {
  if (!isObjectId(channelId)) throw badRequest('Invalid channel id');

  const channel = await Channel.findById(channelId).lean();
  if (!channel) throw notFound('Channel not found.');

  const community = await Community.findById(channel.communityId).lean();
  if (!community) throw notFound('Community not found.');

  const { role, permissions } = communityPermissions(community, userId);

  if (!optionalUser && !role) {
    throw forbidden('Join this server to access its channels.');
  }
  if (!permissions.includes(capability)) {
    throw forbidden('You do not have permission to do that in this channel.');
  }

  const gate = mode === 'write' ? channel.minRoleToWrite : channel.minRoleToRead;
  if (!roleAtLeast(role, gate)) {
    throw forbidden(mode === 'write'
      ? 'You do not have permission to post in this channel.'
      : 'You do not have permission to read this channel.');
  }

  return { channel, community, role, permissions };
}

module.exports = { loadChannelAccess, isObjectId };
