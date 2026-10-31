const express = require('express');
const router = express.Router();
const { protect, optionalProtect, activeOnly } = require('../middleware/auth');
const attachmentUpload = require('../middleware/attachmentUpload');

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

const {
  toggleReaction,
  togglePin,
  getPinnedMessages,
  searchMessages
} = require('../controllers/messageController');

const {
  listForumPosts,
  createForumPost,
  getForumPost,
  updateForumPost,
  deleteForumPost,
  setForumPostStatus,
  createForumReply,
  updateForumReply,
  deleteForumReply
} = require('../controllers/forumController');

const {
  uploadAttachment,
  getAttachmentUrl,
  deleteAttachment
} = require('../controllers/attachmentController');

const {
  createReport,
  listReports,
  reviewReport,
  setTimeout: setTimeoutMember,
  liftTimeout,
  banMember,
  unbanMember,
  listBans
} = require('../controllers/moderationController');

// ⚠️ Static/specific routes MUST come before wildcard /:slug routes

// ── Channel-scoped: messages, reactions, pins, attachments ──────────────────
router.get('/channels/:channelId/messages', optionalProtect, getChannelMessages);
router.get('/channels/:channelId/pins',     protect,         getPinnedMessages);

router.post('/channels/:channelId/messages/:messageId/react', protect, activeOnly, toggleReaction);
router.post('/channels/:channelId/messages/:messageId/pin',   protect, activeOnly, togglePin);
router.delete('/channels/:channelId/messages/:messageId/pin', protect, activeOnly, togglePin);

router.post(
  '/channels/:channelId/attachments',
  protect,
  activeOnly,
  attachmentUpload.single('file'),
  uploadAttachment
);
router.get('/channels/:channelId/attachments/:attachmentId',    protect, getAttachmentUrl);
router.delete('/channels/:channelId/attachments/:attachmentId', protect, activeOnly, deleteAttachment);

// ── Forum channels ──────────────────────────────────────────────────────────
router.get('/:id/channels/:channelId/forum',           protect, listForumPosts);
router.post('/:id/channels/:channelId/forum',          protect, activeOnly, createForumPost);
router.get('/:id/channels/:channelId/forum/:postId',   protect, getForumPost);
router.put('/:id/channels/:channelId/forum/:postId',   protect, activeOnly, updateForumPost);
router.delete('/:id/channels/:channelId/forum/:postId', protect, activeOnly, deleteForumPost);
router.patch('/:id/channels/:channelId/forum/:postId/status', protect, activeOnly, setForumPostStatus);

router.post('/:id/channels/:channelId/forum/:postId/replies', protect, activeOnly, createForumReply);
router.put('/:id/channels/:channelId/forum/:postId/replies/:replyId', protect, activeOnly, updateForumReply);
router.delete('/:id/channels/:channelId/forum/:postId/replies/:replyId', protect, activeOnly, deleteForumReply);

// ── Server administration ───────────────────────────────────────────────────
router.get('/:id/members',            protect, getCommunityMembers);
router.get('/:id/audit',              protect, getAuditLog);
router.get('/:id/search',             protect, searchMessages);
router.patch('/:id',                  protect, activeOnly, updateCommunity);
router.delete('/:id',                 protect, activeOnly, deleteCommunity);

// ── Moderation ──────────────────────────────────────────────────────────────
router.post('/:id/reports',              protect, createReport);
router.get('/:id/reports',               protect, listReports);
router.patch('/:id/reports/:reportId',   protect, activeOnly, reviewReport);

router.post('/:id/members/:userId/timeout',   protect, activeOnly, setTimeoutMember);
router.delete('/:id/members/:userId/timeout', protect, activeOnly, liftTimeout);

router.get('/:id/bans',                protect, listBans);
router.post('/:id/bans/:userId',       protect, activeOnly, banMember);
router.delete('/:id/bans/:userId',     protect, activeOnly, unbanMember);

// ── Channel administration ──────────────────────────────────────────────────
router.post('/:id/channels',                 protect, activeOnly, createChannel);
router.patch('/:id/channels/:channelId',     protect, activeOnly, updateChannel);
router.delete('/:id/channels/:channelId',    protect, activeOnly, deleteChannel);

// ── Membership ──────────────────────────────────────────────────────────────
router.post('/:id/join',                    protect, activeOnly, joinCommunity);
router.post('/:id/leave',                   protect, leaveCommunity);
router.post('/:id/members',                 protect, activeOnly, addMember);
router.patch('/:id/members/:userId/role',   protect, activeOnly, updateMemberRole);
router.delete('/:id/members/:userId',       protect, activeOnly, kickMember);

// ── Communities CRUD ────────────────────────────────────────────────────────
router.post('/',  protect, activeOnly, createCommunity);
router.get('/',   optionalProtect, getCommunities);

// Wildcard slug route — MUST be last
router.get('/:slug', optionalProtect, getCommunityBySlug);

module.exports = router;
