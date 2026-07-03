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
 *   POST   /users/:id/report             — report a user profile (UGC moderation)
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { getUserById, updateUser, searchUsers, sanitizeUser, toggleBlockUser, isBlocked, setContactAlias, deleteContactAlias, getContactAlias, updatePresenceStatus, verifyAccountDeletionAuth } = require('../services/userService');
const { getUserChats } = require('../services/chatService');
const { deleteAccount } = require('../services/chatService');
const { deleteFromS3 } = require('../utils/s3Delete');
const { signAvatarUrl, signUserAvatars } = require('../utils/s3Sign');
const { initiateEmailChange, verifyEmailChange } = require('../services/authService');
const { createReport } = require('../services/contentReportService');
const { getDb } = require('../config/database');
const { emailSendLimiter, otpVerifyLimiter, reportLimiter } = require('../middleware/rateLimits');

const router = express.Router();
router.use(authMiddleware);

// GET /users/me
router.get('/me', async (req, res) => {
  const user = getUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const data = sanitizeUser(user, { showPrivate: true });
  if (data.avatar_url) data.avatar_url = await signAvatarUrl(data.avatar_url);
  res.json(data);
});

// PATCH /users/me
router.patch('/me', async (req, res, next) => {
  try {
    const {
      username, display_name, avatar_url, bio, birth_date,
      hide_email, hide_bio, hide_birth_date, no_group_add,
      hide_avatar, avatar_exceptions, hide_last_seen,
      theme, accent_color, app_bg,
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
      theme, accent_color, app_bg,
    });

    // Delete old avatar from S3 if it was replaced (fire-and-forget)
    if (oldAvatarUrl && oldAvatarUrl !== avatar_url) deleteFromS3(oldAvatarUrl);

    const data = sanitizeUser(updated, { showPrivate: true });
    if (data.avatar_url) data.avatar_url = await signAvatarUrl(data.avatar_url);
    res.json(data);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    next(err);
  }
});

// DELETE /users/me — permanently delete account.
// Requires the current password (+ a valid TOTP/backup code if 2FA is enabled) in the
// body — a bare valid session is not enough, since a session left open on a shared
// device would otherwise let anyone irreversibly delete the account in one request.
router.delete('/me', otpVerifyLimiter, async (req, res, next) => {
  try {
    const { password, code } = req.body || {};
    await verifyAccountDeletionAuth(req.userId, password, code);

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
router.post('/me/request-email-change', emailSendLimiter, async (req, res, next) => {
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
router.post('/me/verify-email-change', otpVerifyLimiter, async (req, res, next) => {
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
  const existing = getDb().prepare('SELECT id FROM users WHERE username = ?').get(username);
  res.json({ available: !existing });
});

// GET /users/search?q=...
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const users = searchUsers(q, req.userId);
  await signUserAvatars(users);
  res.json(users);
});

// GET /users/:id — public profile (with block status + alias)
router.get('/:id', async (req, res, next) => {
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
    if (sanitized.avatar_url) sanitized.avatar_url = await signAvatarUrl(sanitized.avatar_url);
    res.json(sanitized);
  } catch (err) { next(err); }
});

// PATCH /users/me/status — set or clear presence intention status (F3)
router.patch('/me/status', async (req, res, next) => {
  try {
    const { status, note, expires_at } = req.body;
    // status=null or status='' clears the status
    const normalized = (status === '' || status === null || status === undefined) ? null : status;

    const updated = updatePresenceStatus(req.userId, {
      status: normalized,
      note: note ?? null,
      expires_at: expires_at ?? null,
    });

    const io = req.app.get('io');
    if (io) {
      // Broadcast to all chat members so they see the updated status in real-time
      const chats = getUserChats(req.userId);
      const notified = new Set();
      for (const chat of chats) {
        for (const member of chat.members) {
          if (member.id !== req.userId && !notified.has(member.id)) {
            io.to(`user:${member.id}`).emit('presence-status-update', {
              userId: req.userId,
              status: updated.presence_status ?? null,
              note: updated.presence_note ?? null,
              expires_at: updated.presence_expires_at ?? null,
            });
            notified.add(member.id);
          }
        }
      }
    }

    res.json(sanitizeUser(updated, { showPrivate: true }));
  } catch (err) { next(err); }
});

// POST /users/:id/block — toggle block
router.post('/:id/block', (req, res, next) => {
  try {
    if (req.params.id === req.userId) return res.status(400).json({ error: 'Cannot block yourself' });
    const result = toggleBlockUser(req.userId, req.params.id);
    // Notify the blocked/unblocked user in real time
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${req.params.id}`).emit('block-status-changed', {
        blockerId: req.userId,
        blocked: result.is_blocked,
      });
    }
    res.json(result);
  } catch (err) { next(err); }
});

// POST /users/:id/report — body: { reason?: string }
router.post('/:id/report', reportLimiter, (req, res, next) => {
  try {
    if (req.params.id === req.userId) return res.status(400).json({ error: 'Нельзя пожаловаться на себя' });
    const target = getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    res.json(createReport(req.userId, 'user', req.params.id, req.body?.reason));
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
