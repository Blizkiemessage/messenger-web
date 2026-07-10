'use strict';

/**
 * routes/admin/chats.js — chat list + cascade delete with S3 cleanup.
 *   GET    /chats        — list (with ?search=) + member counts
 *   DELETE /chats/:id    — cascade delete + S3 attachment cleanup
 */
const express = require('express');
const { getDb } = require('../../config/database');
const { deleteManyFromS3 } = require('../../utils/s3Delete');
const { logAdminAction } = require('../../services/adminAuditService');
const { clientIp } = require('./_shared');

const router = express.Router();

// GET /chats?search=<query>
// Filtering is done in JS, not SQL: SQLite's LOWER() only folds ASCII a-z
// (no ICU extension loaded), so `WHERE LOWER(name) LIKE ?` silently never
// matches non-ASCII names — a chat named "Тестовая группа" would never be
// found by searching "тестовая". JS's toLowerCase() is Unicode-aware, so
// comparing there (same pattern already used by the admin UI's own
// Pages.users.search()) is correct for any script, not just Latin.
router.get('/chats', (req, res, next) => {
  try {
    const db = getDb();
    const chats = db.prepare(`
      SELECT c.id, c.type, c.name, c.created_at, c.creator_id, COUNT(cm.user_id) as member_count
      FROM chats c
      LEFT JOIN chat_members cm ON c.id = cm.chat_id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `).all();

    const search = req.query.search ? req.query.search.toLowerCase() : null;
    const result = search
      ? chats.filter(c => (c.name || '').toLowerCase().includes(search))
      : chats;

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// DELETE /chats/:id
router.delete('/chats/:id', (req, res, next) => {
  try {
    const db = getDb();
    const chatId = req.params.id;

    // Collect S3 objects before cascade
    const chat = db.prepare('SELECT avatar_url, type, name FROM chats WHERE id = ?').get(chatId);
    const msgAttachments = db
      .prepare('SELECT attachment_url FROM messages WHERE chat_id = ? AND attachment_url IS NOT NULL')
      .all(chatId)
      .map(r => r.attachment_url);

    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId);
      db.prepare('DELETE FROM chat_members WHERE chat_id = ?').run(chatId);
      db.prepare('DELETE FROM chats WHERE id = ?').run(chatId);
      db.exec('COMMIT');
      // Fire-and-forget S3 cleanup
      deleteManyFromS3([chat?.avatar_url, ...msgAttachments]);
      logAdminAction({
        adminUserId: req.userId,
        action: 'delete_chat',
        targetType: 'chat',
        targetId: chatId,
        targetMeta: { type: chat?.type, name: chat?.name },
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
