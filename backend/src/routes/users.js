/**
 * routes/users.js
 *
 * User profile endpoints.
 * Business logic lives in userService.
 *
 * Routes:
 *   GET    /users/me                     — own profile (with private fields)
 *   PATCH  /users/me                     — update own profile
 *   DELETE /users/me                     — permanently delete own account
 *   POST   /users/me/request-email-change — send OTP to new email
 *   POST   /users/me/verify-email-change  — verify OTP and update email
 *   GET    /users/check-username         — availability check
 *   GET    /users/search                 — search by username / display_name
 *   GET    /users/:id                    — public profile of another user
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { getUserById, updateUser, searchUsers, sanitizeUser, toggleBlockUser, isBlocked, setContactAlias, deleteContactAlias, getContactAlias } = require('../services/userService');
const { deleteAccount } = require('../services/chatService');
const { deleteFromS3 } = require('../utils/s3Delete');
const { initiateEmailChange, verifyEmailChange } = require('../services/authService');

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
    const {
      username, display_name, avatar_url, bio, birth_date,
      hide_email, hide_bio, hide_birth_date, no_group_add,
      hide_avatar, avatar_exceptions, hide_last_seen,
      theme, accent_color,
    } = req.body;

    // Capture old avatar before overwriting
    let oldAvatarUrl = null;
    if (avatar_url !== undefined) {
      const cur = getUserById(req.userId);
      oldAvatarUrl = cur?.avatar_url || null;
    }

    const updated = updateUser(req.userId, {
      username, display_name, avatar_url, bio,
      birth_date, hide_email, hide_bio, hide_birth_date, no_group_add,
      hide_avatar, avatar_exceptions, hide_last_seen,
      theme, accent_color,
    });

    // Delete old avatar from S3 if it was replaced (fire-and-forget)
    if (oldAvatarUrl && oldAvatarUrl !== avatar_url) deleteFromS3(oldAvatarUrl);

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
      for (const { chatId, sysMsg, remainingUserIds } of groupNotifications) {
        for (const uid of remainingUserIds) {
          io.to(`user:${uid}`).emit('new-message', sysMsg);
        }
      }
      for (const chatId of deletedDirectChatIds) {
        for (const uid of directChatMembersMap[chatId] || []) {
          if (uid !== req.userId) {
            io.to(`user:${uid}`).emit('chat-removed', { chatId });
          }
        }
      }
      io.to(`user:${req.userId}`).emit('account-deleted');
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /users/me/request-email-change — step 1: send OTP to new email
router.post('/me/request-email-change', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email обязателен' });
    }
    const result = await initiateEmailChange(req.userId, email.trim());
    res.json(result);
  } catch (err) { next(err); }
});

// POST /users/me/verify-email-change — step 2: verify OTP and update email
router.post('/me/verify-email-change', async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email обязателен' });
    }
    if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(otp.trim())) {
      return res.status(400).json({ error: 'Код должен состоять из 6 цифр' });
    }
    const user = await verifyEmailChange(req.userId, email.trim(), otp.trim());
    res.json(user);
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

// GET /users/:id — public profile (with block status + alias)
router.get('/:id', (req, res, next) => {
  try {
    const user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    // alias / block fields are best-effort — degrade gracefully if tables not yet created
    let alias = null, isBlk = false, blkByThem = false;
    try { alias    = getContactAlias(req.userId, req.params.id); } catch { /* table not yet created */ }
    try { isBlk    = isBlocked(req.userId, req.params.id); }      catch { /* table not yet created */ }
    try { blkByThem = isBlocked(req.params.id, req.userId); }     catch { /* table not yet created */ }
    const sanitized = sanitizeUser(user, { viewerId: req.userId }, alias);
    sanitized.is_blocked      = isBlk;
    sanitized.blocked_by_them = blkByThem;
    sanitized.alias           = alias;
    res.json(sanitized);
  } catch (err) { next(err); }
});

// POST /users/:id/block — toggle block
router.post('/:id/block', (req, res, next) => {
  try {
    if (req.params.id === req.userId) return res.status(400).json({ error: 'Cannot block yourself' });
    const result = toggleBlockUser(req.userId, req.params.id);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /users/:id/alias — set contact alias
router.post('/:id/alias', (req, res, next) => {
  try {
    const { alias } = req.body;
    if (!alias || typeof alias !== 'string' || !alias.trim()) {
      return res.status(400).json({ error: 'alias is required' });
    }
    if (alias.trim().length > 50) {
      return res.status(400).json({ error: 'alias max 50 characters' });
    }
    const result = setContactAlias(req.userId, req.params.id, alias.trim());
    res.json(result);
  } catch (err) { next(err); }
});

// DELETE /users/:id/alias — remove contact alias
router.delete('/:id/alias', (req, res, next) => {
  try {
    const result = deleteContactAlias(req.userId, req.params.id);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
