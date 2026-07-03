'use strict';

/**
 * routes/admin/moderation.js — content reports + sticker pack moderation.
 *   GET   /content-reports?resolved=0
 *   PATCH /content-reports/:id/dismiss
 *   GET   /sticker-packs
 *   DELETE /sticker-packs/:id    (soft-delete + close related reports)
 */
const express = require('express');
const { getDb } = require('../../config/database');
const { logAdminAction } = require('../../services/adminAuditService');
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
