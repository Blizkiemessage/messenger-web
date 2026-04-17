const express = require('express');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../middleware/auth');
const { getDb } = require('../config/database');
const { sign } = require('../utils/jwt');
const { deleteManyFromS3 } = require('../utils/s3Delete');

const router = express.Router();

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Слишком много попыток. Попробуйте через 15 минут.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /admin/api/login
router.post('/login', adminLoginLimiter, (req, res, next) => {
  try {
    const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      return res.status(503).json({ error: 'Admin not configured' });
    }

    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username и пароль обязательны' });
    }
    if (username.toLowerCase() !== ADMIN_USERNAME.toLowerCase() || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    const db = getDb();
    const user = db.prepare('SELECT id FROM users WHERE LOWER(username) = ?').get(ADMIN_USERNAME.toLowerCase());

    if (!user) {
      return res.status(404).json({ error: 'Admin user not found in DB' });
    }

    // Create a real revocable session
    const jti = uuidv4();
    const now = Date.now();
    db.prepare('INSERT INTO sessions (id, user_id, created_at, revoked) VALUES (?, ?, ?, 0)')
      .run([jti, user.id, now]);

    const token = sign({ sub: user.id, jti });
    res.json({ token });
  } catch (err) {
    next(err);
  }
});

router.use(authMiddleware);

// Middleware to ensure the user is the configured admin
function isAdmin(req, res, next) {
  const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
  if (!ADMIN_USERNAME) {
    return res.status(503).json({ error: 'Admin not configured' });
  }
  const db = getDb();
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.userId);

  if (!user || user.username.toLowerCase() !== ADMIN_USERNAME.toLowerCase()) {
    return res.status(403).json({ error: 'Access denied: Admins only' });
  }
  next();
}

router.use(isAdmin);

// GET /admin/api/stats?from=<ms>&to=<ms>
router.get('/stats', (req, res, next) => {
  try {
    const db = getDb();
    const from = req.query.from ? parseInt(req.query.from) : null;
    const to   = req.query.to   ? parseInt(req.query.to)   : null;

    // Build a WHERE clause fragment and params for date filtering
    function dateWhere(alias) {
      const col = alias ? `${alias}.created_at` : 'created_at';
      if (from && to)  return { where: `WHERE ${col} >= ? AND ${col} <= ?`, params: [from, to] };
      if (from)        return { where: `WHERE ${col} >= ?`,               params: [from] };
      if (to)          return { where: `WHERE ${col} <= ?`,               params: [to] };
      return { where: '', params: [] };
    }

    function countTable(table) {
      const { where, params } = dateWhere('');
      return db.prepare(`SELECT COUNT(*) as c FROM ${table} ${where}`).get(params).c;
    }

    function countSupport(type) {
      const { where, params } = dateWhere('');
      const and = where ? ' AND type = ?' : 'WHERE type = ?';
      return db.prepare(`SELECT COUNT(*) as c FROM support_reports ${where}${and}`).get([...params, type]).c;
    }

    const contentReports = db.prepare("SELECT COUNT(*) as c FROM content_reports WHERE resolved = 0").get().c;

    res.json({
      users:            countTable('users'),
      chats:            countTable('chats'),
      messages:         countTable('messages'),
      support_bugs:     countSupport('bug'),
      support_features: countSupport('feature'),
      content_reports:  contentReports,
    });
  } catch (err) {
    next(err);
  }
});

// GET /admin/api/users?search=<query>
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

// DELETE /admin/api/users/:id
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
      res.json({ ok: true });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } catch (err) {
    next(err);
  }
});

// GET /admin/api/chats
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
    res.json(chats);
  } catch (err) {
    next(err);
  }
});

// DELETE /admin/api/chats/:id
router.delete('/chats/:id', (req, res, next) => {
  try {
    const db = getDb();

    // Collect S3 objects before cascade
    const chat = db.prepare('SELECT avatar_url FROM chats WHERE id = ?').get(req.params.id);
    const msgAttachments = db
      .prepare('SELECT attachment_url FROM messages WHERE chat_id = ? AND attachment_url IS NOT NULL')
      .all(req.params.id)
      .map(r => r.attachment_url);

    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM messages WHERE chat_id = ?').run(req.params.id);
      db.prepare('DELETE FROM chat_members WHERE chat_id = ?').run(req.params.id);
      db.prepare('DELETE FROM chats WHERE id = ?').run(req.params.id);
      db.exec('COMMIT');
      // Fire-and-forget S3 cleanup
      deleteManyFromS3([chat?.avatar_url, ...msgAttachments]);
      res.json({ ok: true });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } catch (err) {
    next(err);
  }
});

// ── Content reports ──────────────────────────────────────────────────────────

// GET /admin/api/content-reports?resolved=0
router.get('/content-reports', (req, res, next) => {
  try {
    const db = getDb();
    const resolved = req.query.resolved === '1' ? 1 : 0;
    const rows = db.prepare(`
      SELECT cr.*,
        u.username AS reporter_username, u.display_name AS reporter_name,
        sp.name AS pack_name, sp.type AS pack_type, sp.cover_url AS pack_cover,
        ou.username AS owner_username
      FROM content_reports cr
      LEFT JOIN users u ON cr.reporter_id = u.id
      LEFT JOIN sticker_packs sp ON cr.content_id = sp.id
      LEFT JOIN users ou ON sp.owner_id = ou.id
      WHERE cr.resolved = ?
      ORDER BY cr.created_at DESC
    `).all([resolved]);
    res.json(rows);
  } catch (err) { next(err); }
});

// PATCH /admin/api/content-reports/:id/dismiss
router.patch('/content-reports/:id/dismiss', (req, res, next) => {
  try {
    const db = getDb();
    db.prepare('UPDATE content_reports SET resolved = 1 WHERE id = ?').run([req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Sticker packs moderation ─────────────────────────────────────────────────

// GET /admin/api/sticker-packs
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

// DELETE /admin/api/sticker-packs/:id
router.delete('/sticker-packs/:id', (req, res, next) => {
  try {
    const db = getDb();
    db.prepare('UPDATE sticker_packs SET is_deleted = 1 WHERE id = ?').run([req.params.id]);
    // Mark all related reports resolved
    db.prepare("UPDATE content_reports SET resolved = 1 WHERE content_id = ? AND content_type = 'sticker_pack'").run([req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
