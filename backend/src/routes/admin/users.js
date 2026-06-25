'use strict';

/**
 * routes/admin/users.js — user management + their sessions.
 *   GET    /users                  — list (with ?search=)
 *   GET    /users/:id              — full profile + counts
 *   GET    /users/:id/sessions     — active sessions
 *   DELETE /users/:id              — cascade delete + S3 cleanup
 *   DELETE /sessions/:id           — revoke one session
 */
const express = require('express');
const { getDb } = require('../../config/database');
const { deleteManyFromS3 } = require('../../utils/s3Delete');
const { logAdminAction } = require('../../services/adminAuditService');
const { setEntitlement } = require('../../services/dataAssistantService');
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

// GET /users/:id — full user profile
router.get('/users/:id', (req, res, next) => {
  try {
    const db   = getDb();
    const user = db.prepare(
      `SELECT id, username, display_name, email, avatar_url, bio, birth_date,
              created_at, last_seen_at, totp_enabled,
              hide_bio, hide_birth_date, hide_email, hide_last_seen, hide_avatar,
              no_group_add, theme, accent_color, presence_status, presence_note
       FROM users WHERE id = ?`
    ).get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const sessionCount = db.prepare(
      'SELECT COUNT(*) AS c FROM sessions WHERE user_id = ? AND revoked = 0'
    ).get(req.params.id).c;

    const msgCount = db.prepare(
      'SELECT COUNT(*) AS c FROM messages WHERE sender_id = ? AND deleted_at IS NULL'
    ).get(req.params.id).c;

    res.json({ ...user, session_count: sessionCount, message_count: msgCount });
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

// DELETE /users/:id
router.delete('/users/:id', (req, res, next) => {
  try {
    const db = getDb();
    const targetUserId = req.params.id;

    if (targetUserId === req.userId) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    // Collect S3 objects before cascade
    const targetUser = db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(targetUserId);
    const msgAttachments = db
      .prepare('SELECT attachment_url FROM messages WHERE sender_id = ? AND attachment_url IS NOT NULL')
      .all(targetUserId)
      .map(r => r.attachment_url);

    // Cascade delete manually just in case PRAGMA foreign_keys is off
    const deletedUser = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(targetUserId);

    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM messages WHERE sender_id = ?').run(targetUserId);
      db.prepare('DELETE FROM chat_members WHERE user_id = ?').run(targetUserId);
      db.prepare('DELETE FROM users WHERE id = ?').run(targetUserId);
      // Clean up any empty direct chats
      db.exec(`
        DELETE FROM chats
        WHERE type = 'direct'
        AND id NOT IN (SELECT chat_id FROM chat_members)
      `);
      db.exec('COMMIT');
      // Fire-and-forget S3 cleanup
      deleteManyFromS3([targetUser?.avatar_url, ...msgAttachments]);
      logAdminAction({
        adminUserId: req.userId,
        action: 'delete_user',
        targetType: 'user',
        targetId: targetUserId,
        targetMeta: { username: deletedUser?.username, display_name: deletedUser?.display_name },
        ipAddress: clientIp(req),
        userAgent: req.headers['user-agent'] || null,
      });
      res.json({ ok: true });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
