const express = require('express');
const router = express.Router();
const { protect, optionalProtect } = require('../middleware/auth');
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

router.post('/channels/:channelId/messages/:messageId/react', protect, toggleReaction);
router.post('/channels/:channelId/messages/:messageId/pin',   protect, togglePin);
router.delete('/channels/:channelId/messages/:messageId/pin', protect, togglePin);

router.post(
  '/channels/:channelId/attachments',
  protect,
  attachmentUpload.single('file'),
  uploadAttachment
);
router.get('/channels/:channelId/attachments/:attachmentId',    protect, getAttachmentUrl);
router.delete('/channels/:channelId/attachments/:attachmentId', protect, deleteAttachment);

// ── Forum channels ──────────────────────────────────────────────────────────
router.get('/:id/channels/:channelId/forum',           protect, listForumPosts);
router.post('/:id/channels/:channelId/forum',          protect, createForumPost);
router.get('/:id/channels/:channelId/forum/:postId',   protect, getForumPost);
router.put('/:id/channels/:channelId/forum/:postId',   protect, updateForumPost);
router.delete('/:id/channels/:channelId/forum/:postId', protect, deleteForumPost);
router.patch('/:id/channels/:channelId/forum/:postId/status', protect, setForumPostStatus);

router.post('/:id/channels/:channelId/forum/:postId/replies', protect, createForumReply);
router.put('/:id/channels/:channelId/forum/:postId/replies/:replyId', protect, updateForumReply);
router.delete('/:id/channels/:channelId/forum/:postId/replies/:replyId', protect, deleteForumReply);

// ── Server administration ───────────────────────────────────────────────────
router.get('/:id/members',            protect, getCommunityMembers);
router.get('/:id/audit',              protect, getAuditLog);
router.get('/:id/search',             protect, searchMessages);
router.patch('/:id',                  protect, updateCommunity);
router.delete('/:id',                 protect, deleteCommunity);

// ── Moderation ──────────────────────────────────────────────────────────────
router.post('/:id/reports',              protect, createReport);
router.get('/:id/reports',               protect, listReports);
router.patch('/:id/reports/:reportId',   protect, reviewReport);

router.post('/:id/members/:userId/timeout',   protect, setTimeoutMember);
router.delete('/:id/members/:userId/timeout', protect, liftTimeout);

router.get('/:id/bans',                protect, listBans);
router.post('/:id/bans/:userId',       protect, banMember);
router.delete('/:id/bans/:userId',     protect, unbanMember);

// ── Channel administration ──────────────────────────────────────────────────
router.post('/:id/channels',                 protect, createChannel);
router.patch('/:id/channels/:channelId',     protect, updateChannel);
router.delete('/:id/channels/:channelId',    protect, deleteChannel);

// ── Membership ──────────────────────────────────────────────────────────────
router.post('/:id/join',                    protect, joinCommunity);
router.post('/:id/leave',                   protect, leaveCommunity);
router.post('/:id/members',                 protect, addMember);
router.patch('/:id/members/:userId/role',   protect, updateMemberRole);
router.delete('/:id/members/:userId',       protect, kickMember);

// ── Communities CRUD ────────────────────────────────────────────────────────
router.post('/',  protect,         createCommunity);
router.get('/',   optionalProtect, getCommunities);

// Wildcard slug route — MUST be last
router.get('/:slug', optionalProtect, getCommunityBySlug);

module.exports = router;
