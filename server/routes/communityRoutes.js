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

// ⚠️ Static/specific routes MUST come before wildcard /:slug or /:id routes

// Channel Messages — declared first to avoid being matched as /:slug = 'channels'
router.get   ('/channels/:channelId/messages',     optionalProtect, getChannelMessages);

// Communities CRUD
router.post  ('/',                                 protect,         createCommunity);
router.get   ('/',                                 optionalProtect, getCommunities);
// Channels scoped to a community
router.post  ('/:id/channels',                     protect,         createChannel);
// Member management
router.post  ('/:id/join',                         protect,         joinCommunity);
router.post  ('/:id/leave',                        protect,         leaveCommunity);
router.patch ('/:id/members/:userId/role',         protect,         updateMemberRole);
router.delete('/:id',                              protect,         deleteCommunity);
// Wildcard slug/id routes — MUST be last
router.get   ('/:slug',                            optionalProtect, getCommunityBySlug);

module.exports = router;
