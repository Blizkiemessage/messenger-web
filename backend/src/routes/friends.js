const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { friendRequestLimiter } = require('../middleware/rateLimits');
const {
  createFriendRequest,
  acceptFriendRequest,
  cancelFriendRequest,
  removeFriend,
  listFriends,
  listIncomingRequests,
  getRelationshipStatuses,
} = require('../services/friendsService');
const { signUserAvatars, signAvatarUrl } = require('../utils/s3Sign');

const router = express.Router();
router.use(authMiddleware);

// GET /friends
router.get('/', async (req, res) => {
  const friends = listFriends(req.userId);
  await signUserAvatars(friends);
  res.json(friends);
});

// GET /friends/requests
router.get('/requests', async (req, res) => {
  const requests = listIncomingRequests(req.userId);
  await Promise.all(requests.map(async (r) => {
    if (r.user?.avatar_url) r.user.avatar_url = await signAvatarUrl(r.user.avatar_url);
  }));
  res.json(requests);
});

// GET /friends/status?ids=a,b,c
router.get('/status', (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  res.json(getRelationshipStatuses(req.userId, ids));
});

// POST /friends/request { userId }
router.post('/request', friendRequestLimiter, (req, res, next) => {
  try {
    const { userId } = req.body;
    res.json(createFriendRequest(req.userId, userId));
  } catch (e) {
    next(e);
  }
});

// POST /friends/accept { userId }   // userId = who requested you
router.post('/accept', friendRequestLimiter, (req, res, next) => {
  try {
    const { userId } = req.body;
    res.json(acceptFriendRequest(req.userId, userId));
  } catch (e) {
    next(e);
  }
});

// POST /friends/cancel { userId }   // cancel outgoing request
router.post('/cancel', (req, res) => {
  const { userId } = req.body;
  res.json(cancelFriendRequest(req.userId, userId));
});

// DELETE /friends/:userId
router.delete('/:userId', (req, res) => {
  res.json(removeFriend(req.userId, req.params.userId));
});

module.exports = router;

