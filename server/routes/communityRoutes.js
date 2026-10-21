const express = require('express');
const router = express.Router();
const { protect, optionalProtect } = require('../middleware/auth');

const {
  createCommunity,
  getCommunities,
  getCommunityBySlug,
  getCommunityMembers,
  joinCommunity,
  leaveCommunity,
  addMember,
  updateMemberRole,
  kickMember,
  updateCommunity,
  deleteCommunity,
  createChannel,
  updateChannel,
  deleteChannel,
  getChannelMessages,
  getAuditLog
} = require('../controllers/communityController');

// ⚠️ Static/specific routes MUST come before wildcard /:slug routes

// Channel messages (declared first so “channels” is never read as a slug)
router.get('/channels/:channelId/messages', optionalProtect, getChannelMessages);

// Server administration
router.get('/:id/members',            protect, getCommunityMembers);
router.get('/:id/audit',              protect, getAuditLog);
router.patch('/:id',                  protect, updateCommunity);
router.delete('/:id',                 protect, deleteCommunity);

// Channel administration
router.post('/:id/channels',                 protect, createChannel);
router.patch('/:id/channels/:channelId',     protect, updateChannel);
router.delete('/:id/channels/:channelId',    protect, deleteChannel);

// Membership
router.post('/:id/join',                    protect, joinCommunity);
router.post('/:id/leave',                   protect, leaveCommunity);
router.post('/:id/members',                 protect, addMember);
router.patch('/:id/members/:userId/role',   protect, updateMemberRole);
router.delete('/:id/members/:userId',       protect, kickMember);

// Communities CRUD
router.post('/',  protect,         createCommunity);
router.get('/',   optionalProtect, getCommunities);

// Wildcard slug route — MUST be last
router.get('/:slug', optionalProtect, getCommunityBySlug);

module.exports = router;
