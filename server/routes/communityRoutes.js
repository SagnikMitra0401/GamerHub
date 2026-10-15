const express  = require('express');
const router   = express.Router();
const { protect, optionalProtect } = require('../middleware/auth');

const {
  createCommunity,
  getCommunities,
  getCommunityBySlug,
  joinCommunity,
  leaveCommunity,
  updateMemberRole,
  createChannel,
  getChannelMessages,
  deleteCommunity
} = require('../controllers/communityController');

// Communities
router.post  ('/',                                 protect,         createCommunity);
router.get   ('/',                                 optionalProtect, getCommunities);
router.get   ('/:slug',                            optionalProtect, getCommunityBySlug);
router.delete('/:id',                              protect,         deleteCommunity);
router.post  ('/:id/join',                         protect,         joinCommunity);
router.post  ('/:id/leave',                        protect,         leaveCommunity);
router.patch ('/:id/members/:userId/role',         protect,         updateMemberRole);

// Channels (scoped to a community)
router.post  ('/:id/channels',                     protect,         createChannel);

// Channel Messages (separate channel-level path)
router.get   ('/channels/:channelId/messages',     optionalProtect, getChannelMessages);

module.exports = router;
