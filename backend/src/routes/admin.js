const express = require('express');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../middleware/auth');
const { getDb } = require('../config/database');
const { sign } = require('../utils/jwt');

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

    res.json({
      users:            countTable('users'),
      chats:            countTable('chats'),
      messages:         countTable('messages'),
      support_bugs:     countSupport('bug'),
      support_features: countSupport('feature'),
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
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM messages WHERE chat_id = ?').run(req.params.id);
      db.prepare('DELETE FROM chat_members WHERE chat_id = ?').run(req.params.id);
      db.prepare('DELETE FROM chats WHERE id = ?').run(req.params.id);
      db.exec('COMMIT');
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
