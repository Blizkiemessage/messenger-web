'use strict';

/**
 * routes/admin/users.js — user management + their sessions.
 *   GET    /users                  — list (with ?search=)
 *   GET    /users/:id              — full profile + counts + moderation info
 *   GET    /users/:id/sessions     — active sessions
 *   POST   /users/:id/ban          — suspend account (revokes sessions)
 *   POST   /users/:id/unban        — lift suspension
 *   POST   /users/:id/warn         — send a moderation warning (in-app + email)
 *   DELETE /users/:id              — full account teardown (via chatService.deleteAccount)
 *   DELETE /sessions/:id           — revoke one session
 */
const express = require('express');
const { getDb } = require('../../config/database');
const { deleteAccount } = require('../../services/chatService');
const { logAdminAction } = require('../../services/adminAuditService');
const { setEntitlement } = require('../../services/dataAssistantService');
const { banUser, unbanUser, warnUser, getModerationInfo } = require('../../services/moderationService');
const { sendModerationWarningEmail } = require('../../config/email');
const { clientIp } = require('./_shared');

const router = express.Router();

// PUT /users/:id/ai-data-entitlement — выдать/забрать доступ к платному
// ассистенту по данным (Этап D). { entitled: boolean }
router.put('/users/:id/ai-data-entitlement', (req, res, next) => {
  try {
    const entitled = !!(req.body && req.body.entitled);
    const status = setEntitlement(req.params.id, entitled);
    logAdminAction({
      adminUserId: req.userId,
      action: entitled ? 'grant_ai_data' : 'revoke_ai_data',
      targetType: 'user',
      targetId: req.params.id,
      ipAddress: clientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });
    res.json(status);
  } catch (err) { next(err); }
});

// GET /users/:id — full user profile + moderation info (ban status, warnings)
router.get('/users/:id', (req, res, next) => {
  try {
    const db   = getDb();
    const user = db.prepare(
      `SELECT id, username, display_name, email, avatar_url, bio, birth_date,
              created_at, last_seen_at, totp_enabled,
              hide_bio, hide_birth_date, hide_email, hide_last_seen, hide_avatar,
              no_group_add, theme, accent_color, presence_status, presence_note,
              is_banned, ban_reason, banned_at
       FROM users WHERE id = ?`
    ).get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const sessionCount = db.prepare(
      'SELECT COUNT(*) AS c FROM sessions WHERE user_id = ? AND revoked = 0'
    ).get(req.params.id).c;

    const msgCount = db.prepare(
      'SELECT COUNT(*) AS c FROM messages WHERE sender_id = ? AND deleted_at IS NULL'
    ).get(req.params.id).c;

    const { warnings } = getModerationInfo(req.params.id);

    res.json({ ...user, session_count: sessionCount, message_count: msgCount, warnings });
  } catch (err) { next(err); }
});

// POST /users/:id/ban — { reason? } — suspend the account and revoke access
router.post('/users/:id/ban', (req, res, next) => {
  try {
    const { sessionIds, ...result } = banUser(req.params.id, req.body?.reason, req.userId);
    const io = req.app.get('io');
    if (io) for (const sid of sessionIds) io.kickSession(sid);
    logAdminAction({
      adminUserId: req.userId,
      action: 'ban_user',
      targetType: 'user',
      targetId: req.params.id,
      targetMeta: { reason: req.body?.reason || null },
      ipAddress: clientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// POST /users/:id/unban
router.post('/users/:id/unban', (req, res, next) => {
  try {
    const result = unbanUser(req.params.id);
    logAdminAction({
      adminUserId: req.userId,
      action: 'unban_user',
      targetType: 'user',
      targetId: req.params.id,
      ipAddress: clientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// POST /users/:id/warn — { message, reportId? } — logged + shown in-app + emailed
router.post('/users/:id/warn', async (req, res, next) => {
  try {
    const db = getDb();
    const target = db.prepare('SELECT username, email FROM users WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });

    const warning = warnUser(req.params.id, req.body?.message, req.userId, req.body?.reportId);

    if (target.email) {
      try {
        await sendModerationWarningEmail({ to: target.email, username: target.username, message: warning.message });
      } catch (emailErr) {
        // Warning is already recorded + visible in-app — email is best-effort
        console.error('[Moderation] Failed to send warning email:', emailErr.message);
      }
    }

    logAdminAction({
      adminUserId: req.userId,
      action: 'warn_user',
      targetType: 'user',
      targetId: req.params.id,
      targetMeta: { message: warning.message, reportId: req.body?.reportId || null },
      ipAddress: clientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });
    res.json(warning);
  } catch (err) { next(err); }
});

// GET /users/:id/sessions — list active sessions for a user
router.get('/users/:id/sessions', (req, res, next) => {
  try {
    const db = getDb();
    const sessions = db.prepare(
      `SELECT id, created_at, last_used_at, ip_address, user_agent, revoked
       FROM sessions WHERE user_id = ?
       ORDER BY last_used_at DESC LIMIT 20`
    ).all(req.params.id);
    res.json(sessions);
  } catch (err) { next(err); }
});

// DELETE /sessions/:id — revoke a specific session
router.delete('/sessions/:id', (req, res, next) => {
  try {
    const db = getDb();
    db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(req.params.id);
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE session_id = ?').run(req.params.id);
    logAdminAction({
      adminUserId: req.userId,
      action: 'revoke_session',
      targetType: 'session',
      targetId: req.params.id,
      ipAddress: clientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /users?search=<query>
router.get('/users', (req, res, next) => {
  try {
    const db = getDb();
    const search = req.query.search ? `%${req.query.search.toLowerCase()}%` : null;
    const users = search
      ? db.prepare('SELECT id, username, display_name, email, created_at, last_seen_at FROM users WHERE LOWER(username) LIKE ? OR LOWER(COALESCE(email, \'\')) LIKE ?').all([search, search])
      : db.prepare('SELECT id, username, display_name, email, created_at, last_seen_at FROM users').all();
    res.json(users);
  } catch (err) {
    next(err);
  }
});

// DELETE /users/:id — full teardown, reusing the exact same path as
// self-service account deletion (services/chat/teardown.js::deleteAccount):
// orphaned messages/calls/notes are reassigned to the "Удалённый аккаунт"
// ghost, not deleted — this used to be a separate ad-hoc reimplementation
// that deleted a departing user's messages even in surviving group chats
// (data loss for other members) and never accounted for calls/chat_notes at
// all (would have hit the same FOREIGN KEY bug fixed 2026-07-03 for the
// user-facing path).
router.delete('/users/:id', (req, res, next) => {
  try {
    const targetUserId = req.params.id;
    if (targetUserId === req.userId) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    const deletedUser = getDb().prepare('SELECT username, display_name FROM users WHERE id = ?').get(targetUserId);
    if (!deletedUser) return res.status(404).json({ error: 'User not found' });

    const { groupNotifications, deletedDirectChatIds, directChatMembersMap } = deleteAccount(targetUserId);

    const io = req.app.get('io');
    if (io) {
      for (const { chatId, sysMsg, remainingUserIds } of groupNotifications) {
        for (const uid of remainingUserIds) io.to(`user:${uid}`).emit('new-message', sysMsg);
      }
      for (const chatId of deletedDirectChatIds) {
        for (const uid of directChatMembersMap[chatId] || []) {
          if (uid !== targetUserId) io.to(`user:${uid}`).emit('chat-removed', { chatId });
        }
      }
      io.to(`user:${targetUserId}`).emit('account-deleted');
    }

    logAdminAction({
      adminUserId: req.userId,
      action: 'delete_user',
      targetType: 'user',
      targetId: targetUserId,
      targetMeta: { username: deletedUser.username, display_name: deletedUser.display_name },
      ipAddress: clientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
