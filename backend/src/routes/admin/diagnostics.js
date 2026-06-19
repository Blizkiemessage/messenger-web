'use strict';

/**
 * routes/admin/diagnostics.js — observability + ops endpoints.
 *   GET    /errors           — app error log (filter by level/tag/search)
 *   DELETE /errors/:id       — delete one entry
 *   DELETE /errors           — clear all (or by level)
 *   GET    /audit-log        — admin audit log
 *   POST   /backup           — manual DB backup trigger
 */
const express = require('express');
const { getDb } = require('../../config/database');
const { logAdminAction } = require('../../services/adminAuditService');
const { clientIp } = require('./_shared');

const router = express.Router();

const ALLOWED_ERROR_LEVELS = new Set(['error', 'warn']);

// ── App error log ────────────────────────────────────────────────────────────

// GET /errors?level=error&tag=[S3Delete]&search=&limit=100&offset=0
router.get('/errors', (req, res, next) => {
  try {
    const db = getDb();
    const level  = ALLOWED_ERROR_LEVELS.has(req.query.level) ? req.query.level : null;
    const tag    = req.query.tag    ? req.query.tag.trim()    : null;
    const search = req.query.search ? `%${req.query.search.trim()}%` : null;
    const limit  = Math.min(parseInt(req.query.limit  || '100'), 500);
    const offset = Math.max(parseInt(req.query.offset || '0'),   0);

    const conditions = [];
    const params = [];

    if (level)  { conditions.push('level = ?');           params.push(level); }
    if (tag)    { conditions.push('tag = ?');             params.push(tag); }
    if (search) { conditions.push('(message LIKE ? OR error_text LIKE ?)'); params.push(search, search); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.prepare(
      `SELECT * FROM app_errors ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`
    ).all([...params, limit, offset]);

    const total = db.prepare(
      `SELECT COUNT(*) AS c FROM app_errors ${where}`
    ).get(params).c;

    // Unique tags for filter dropdown
    const tags = db.prepare('SELECT DISTINCT tag FROM app_errors WHERE tag IS NOT NULL ORDER BY tag').all().map(r => r.tag);

    res.json({ rows, total, tags });
  } catch (err) {
    next(err);
  }
});

// DELETE /errors/:id — remove single entry
router.delete('/errors/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    db.prepare('DELETE FROM app_errors WHERE id = ?').run([id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /errors?level=error — clear all (or by level)
router.delete('/errors', (req, res, next) => {
  try {
    const db = getDb();
    const level = ALLOWED_ERROR_LEVELS.has(req.query.level) ? req.query.level : null;
    if (level) {
      db.prepare('DELETE FROM app_errors WHERE level = ?').run([level]);
    } else {
      db.prepare('DELETE FROM app_errors').run();
    }
    logAdminAction({
      adminUserId: req.userId,
      action: 'clear_app_errors',
      targetType: 'app_errors',
      targetMeta: { level: level || 'all' },
      ipAddress: clientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Audit log ────────────────────────────────────────────────────────────────

// GET /audit-log?limit=50&offset=0&action=delete_user
router.get('/audit-log', (req, res, next) => {
  try {
    const db     = getDb();
    const limit  = Math.min(parseInt(req.query.limit  || '50'),  500);
    const offset = Math.max(parseInt(req.query.offset || '0'),   0);
    const action = req.query.action ? req.query.action.trim() : null;

    const conditions = [];
    const params     = [];
    if (action) { conditions.push('action = ?'); params.push(action); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db.prepare(
      `SELECT al.*, u.username AS admin_username
       FROM admin_audit_log al
       LEFT JOIN users u ON u.id = al.admin_user_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT ? OFFSET ?`
    ).all([...params, limit, offset]);

    const total = db.prepare(
      `SELECT COUNT(*) AS c FROM admin_audit_log ${where}`
    ).get(params).c;

    res.json({ rows, total });
  } catch (err) {
    next(err);
  }
});

// POST /backup — manual DB backup trigger
router.post('/backup', async (req, res, next) => {
  try {
    const { runBackup } = require('../../workers/dbBackup');
    const result = await runBackup();
    if (result.ok) {
      res.json({ ok: true, key: result.key, sizeMb: result.sizeMb });
    } else {
      res.status(503).json({ ok: false, error: result.error });
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
