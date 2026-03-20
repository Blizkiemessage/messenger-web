const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const {
  createFriendRequest,
  acceptFriendRequest,
  cancelFriendRequest,
  removeFriend,
  listFriends,
  listIncomingRequests,
  getRelationshipStatuses,
} = require('../services/friendsService');

const router = express.Router();
router.use(authMiddleware);

// GET /friends
router.get('/', (req, res) => {
  res.json(listFriends(req.userId));
});

// GET /friends/requests
router.get('/requests', (req, res) => {
  res.json(listIncomingRequests(req.userId));
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
router.post('/request', (req, res, next) => {
  try {
    const { userId } = req.body;
    res.json(createFriendRequest(req.userId, userId));
  } catch (e) {
    next(e);
  }
});

// POST /friends/accept { userId }   // userId = who requested you
router.post('/accept', (req, res, next) => {
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

