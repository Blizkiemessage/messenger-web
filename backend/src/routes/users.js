/**
 * routes/users.js
 *
 * User profile endpoints.
 * Business logic lives in userService.
 *
 * Routes:
 *   GET    /users/me              — own profile (with private fields)
 *   PATCH  /users/me              — update own profile
 *   DELETE /users/me              — permanently delete own account
 *   GET    /users/check-username  — availability check
 *   GET    /users/search          — search by username / display_name
 *   GET    /users/:id             — public profile of another user
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { getUserById, updateUser, searchUsers, sanitizeUser } = require('../services/userService');
const { deleteAccount } = require('../services/chatService');

const router = express.Router();
router.use(authMiddleware);

// GET /users/me
router.get('/me', (req, res) => {
  const user = getUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(sanitizeUser(user, { showPrivate: true }));
});

// PATCH /users/me
router.patch('/me', (req, res, next) => {
  try {
    const { username, display_name, avatar_url, bio, birth_date, hide_bio, hide_birth_date, no_group_add } = req.body;
    const updated = updateUser(req.userId, {
      username, display_name, avatar_url, bio,
      birth_date, hide_bio, hide_birth_date, no_group_add,
    });
    res.json(sanitizeUser(updated, { showPrivate: true }));
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    next(err);
  }
});

// DELETE /users/me — permanently delete account
router.delete('/me', (req, res, next) => {
  try {
    const { groupNotifications, deletedDirectChatIds, directChatMembersMap } = deleteAccount(req.userId);

    const io = req.app.get('io');
    if (io) {
      // Notify remaining group members via system message
      for (const { chatId, sysMsg, remainingUserIds } of groupNotifications) {
        for (const uid of remainingUserIds) {
          io.to(`user:${uid}`).emit('new-message', sysMsg);
        }
      }
      // Notify direct chat partners: remove chat from their list
      for (const chatId of deletedDirectChatIds) {
        for (const uid of directChatMembersMap[chatId] || []) {
          if (uid !== req.userId) {
            io.to(`user:${uid}`).emit('chat-removed', { chatId });
          }
        }
      }
      // Force-disconnect the deleted user on all their tabs
      io.to(`user:${req.userId}`).emit('account-deleted');
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /users/check-username?username=xxx
router.get('/check-username', (req, res) => {
  const username = (req.query.username || '').toLowerCase().trim();
  if (!username || !/^[a-z0-9_]{3,32}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3–32 characters: letters, digits, _' });
  }
  const { getDb } = require('../config/database');
  const existing = getDb().prepare('SELECT id FROM users WHERE username = ?').get(username);
  res.json({ available: !existing });
});

// GET /users/search?q=...
router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  res.json(searchUsers(q, req.userId));
});

// GET /users/:id — public profile
router.get('/:id', (req, res) => {
  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(sanitizeUser(user));
});

module.exports = router;
