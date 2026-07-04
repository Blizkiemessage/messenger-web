'use strict';

/**
 * routes/admin/moderation.js — content reports + sticker pack moderation.
 *   GET   /content-reports?resolved=0
 *   GET   /content-reports/:id/report-context  (investigate: decrypted message / user moderation history)
 *   PATCH /content-reports/:id/dismiss
 *   GET   /sticker-packs
 *   DELETE /sticker-packs/:id    (soft-delete + close related reports)
 */
const express = require('express');
const { getDb } = require('../../config/database');
const { decrypt } = require('../../crypto/aes');
const { logAdminAction } = require('../../services/adminAuditService');
const { getModerationInfo } = require('../../services/moderationService');
const { clientIp } = require('./_shared');

const router = express.Router();

// ── Content reports ──────────────────────────────────────────────────────────

// GET /content-reports?resolved=0
router.get('/content-reports', (req, res, next) => {
  try {
    const db = getDb();
    const resolved = req.query.resolved === '1' ? 1 : 0;
    // UGC reporting (2026-07-03) added content_type='message'/'user' alongside
    // the original sticker-pack reports (migration 018). Each join is scoped by
    // content_type so unrelated ids never accidentally match — message/user
    // reports never decrypt message content here (metadata only: chat/sender),
    // keeping the "no plaintext outside the encrypted message flow" invariant.
    const rows = db.prepare(`
      SELECT cr.*,
        u.username AS reporter_username, u.display_name AS reporter_name,
        sp.name AS pack_name, sp.type AS pack_type, sp.cover_url AS pack_cover,
        ou.username AS owner_username,
        tu.username AS target_username, tu.display_name AS target_name,
        m.chat_id AS message_chat_id, m.created_at AS message_created_at,
        su.username AS message_sender_username
      FROM content_reports cr
      LEFT JOIN users u ON cr.reporter_id = u.id
      LEFT JOIN sticker_packs sp ON cr.content_type = 'sticker_pack' AND cr.content_id = sp.id
      LEFT JOIN users ou ON sp.owner_id = ou.id
      LEFT JOIN users tu ON cr.content_type = 'user' AND cr.content_id = tu.id
      LEFT JOIN messages m ON cr.content_type = 'message' AND cr.content_id = m.id
      LEFT JOIN users su ON m.sender_id = su.id
      WHERE cr.resolved = ?
      ORDER BY cr.created_at DESC
    `).all([resolved]);
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /content-reports/:id/report-context — "investigate": what was actually
// reported. Message reports decrypt the text server-side to show the admin —
// the first (and only) code path in the app that ever does this, so it's
// audit-logged like any other sensitive moderation action. User reports
// return moderation history (ban status + past warnings) instead.
router.get('/content-reports/:id/report-context', (req, res, next) => {
  try {
    const db = getDb();
    const report = db.prepare('SELECT * FROM content_reports WHERE id = ?').get(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    if (report.content_type === 'message') {
      const msg = db.prepare(
        `SELECT m.chat_id, m.ciphertext, m.iv, m.auth_tag, m.created_at, m.attachment_type,
                c.name AS chat_name, c.type AS chat_type,
                su.id AS sender_id, su.username AS sender_username
         FROM messages m
         LEFT JOIN chats c ON m.chat_id = c.id
         LEFT JOIN users su ON m.sender_id = su.id
         WHERE m.id = ?`
      ).get(report.content_id);
      if (!msg) return res.json({ content_type: 'message', deleted: true });

      let text = null;
      try { text = decrypt({ ciphertext: msg.ciphertext, iv: msg.iv, authTag: msg.auth_tag }); }
      catch { /* corrupt/legacy row — show attachment-only context */ }

      logAdminAction({
        adminUserId: req.userId,
        action: 'view_reported_content',
        targetType: 'message',
        targetId: report.content_id,
        ipAddress: clientIp(req),
        userAgent: req.headers['user-agent'] || null,
      });

      return res.json({
        content_type: 'message',
        chat_id: msg.chat_id,
        chat_name: msg.chat_name,
        chat_type: msg.chat_type,
        sender_id: msg.sender_id,
        sender_username: msg.sender_username,
        created_at: msg.created_at,
        attachment_type: msg.attachment_type,
        text,
      });
    }

    if (report.content_type === 'user') {
      const user = db.prepare(
        'SELECT id, username, display_name, email, created_at, last_seen_at FROM users WHERE id = ?'
      ).get(report.content_id);
      if (!user) return res.json({ content_type: 'user', deleted: true });
      const info = getModerationInfo(report.content_id);
      return res.json({ content_type: 'user', ...user, ...info });
    }

    res.status(400).json({ error: 'No investigate view for this content_type' });
  } catch (err) { next(err); }
});

// PATCH /content-reports/:id/dismiss
router.patch('/content-reports/:id/dismiss', (req, res, next) => {
  try {
    const db = getDb();
    const reportId = req.params.id;
    const report = db.prepare('SELECT content_type, content_id FROM content_reports WHERE id = ?').get(reportId);
    db.prepare('UPDATE content_reports SET resolved = 1 WHERE id = ?').run([reportId]);
    logAdminAction({
      adminUserId: req.userId,
      action: 'dismiss_content_report',
      targetType: 'content_report',
      targetId: reportId,
      targetMeta: { content_type: report?.content_type, content_id: report?.content_id },
      ipAddress: clientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Sticker packs moderation ─────────────────────────────────────────────────

// GET /sticker-packs
router.get('/sticker-packs', (req, res, next) => {
  try {
    const db = getDb();
    const packs = db.prepare(`
      SELECT sp.*, u.username AS owner_username, u.display_name AS owner_name,
        COUNT(spi.id) AS item_count,
        (SELECT COUNT(*) FROM content_reports cr WHERE cr.content_id = sp.id AND cr.resolved = 0) AS report_count
      FROM sticker_packs sp
      LEFT JOIN users u ON sp.owner_id = u.id
      LEFT JOIN sticker_pack_items spi ON spi.pack_id = sp.id
      WHERE sp.is_deleted = 0
      GROUP BY sp.id
      ORDER BY report_count DESC, sp.created_at DESC
    `).all();
    res.json(packs);
  } catch (err) { next(err); }
});

// DELETE /sticker-packs/:id
router.delete('/sticker-packs/:id', (req, res, next) => {
  try {
    const db = getDb();
    const packId = req.params.id;
    const pack = db.prepare('SELECT name, type, owner_id FROM sticker_packs WHERE id = ?').get(packId);
    db.prepare('UPDATE sticker_packs SET is_deleted = 1 WHERE id = ?').run([packId]);
    // Mark all related reports resolved
    db.prepare("UPDATE content_reports SET resolved = 1 WHERE content_id = ? AND content_type = 'sticker_pack'").run([packId]);
    logAdminAction({
      adminUserId: req.userId,
      action: 'delete_sticker_pack',
      targetType: 'sticker_pack',
      targetId: packId,
      targetMeta: { name: pack?.name, type: pack?.type, owner_id: pack?.owner_id },
      ipAddress: clientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
