'use strict';

/**
 * admin.js — оркестратор админ-API.
 *
 * Здесь: логин (без auth-гейта, под rate-limit), затем auth + isAdmin
 * middleware, затем монтируются под-роутеры из ./admin/*. Каждый под-роутер
 * наследует auth/isAdmin от родителя — реализация роутов лежит по областям:
 *   stats           — /stats
 *   users           — /users, /users/:id, /users/:id/sessions, /sessions/:id
 *   chats           — /chats, /chats/:id
 *   moderation      — /content-reports*, /sticker-packs (модерация)
 *   stickerRepair   — /sticker-repair (self-healing для стикеров)
 *   diagnostics     — /errors, /audit-log, /backup
 *
 * Внешняя точка монтирования (index.js: `app.use('/admin/api', adminRoutes)`)
 * и публичные URL не менялись.
 */
const crypto = require('crypto');
const bcryptjs = require('bcryptjs');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../middleware/auth');
const { adminLoginLimiter } = require('../middleware/rateLimits');
const { getDb } = require('../config/database');
const { sign } = require('../utils/jwt');

const router = express.Router();

// ── Public: login ───────────────────────────────────────────────────────────
// POST /admin/api/login
router.post('/login', adminLoginLimiter, async (req, res, next) => {
  try {
    const expectedUser   = process.env.ADMIN_USERNAME      || '';
    const passwordHash   = process.env.ADMIN_PASSWORD_HASH || '';

    if (!expectedUser || !passwordHash) {
      return res.status(503).json({ error: 'Admin not configured' });
    }

    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username и пароль обязательны' });
    }

    // Timing-safe username comparison (prevents length-based leaks too)
    let usernameMatch = false;
    try {
      const a = Buffer.from(username.toLowerCase());
      const b = Buffer.from(expectedUser.toLowerCase());
      usernameMatch = a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch { usernameMatch = false; }

    // bcrypt.compare is timing-safe by design; always run it to avoid
    // timing difference between "wrong user" and "wrong password" branches.
    const passwordMatch = await bcryptjs.compare(password, passwordHash);

    if (!usernameMatch || !passwordMatch) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const db = getDb();
    const user = db.prepare('SELECT id FROM users WHERE LOWER(username) = ?').get(expectedUser.toLowerCase());

    if (!user) {
      return res.status(404).json({ error: 'Admin user not found in DB' });
    }

    // Create a real revocable session
    const jti = uuidv4();
    const now = Date.now();
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || null;
    db.prepare('INSERT INTO sessions (id, user_id, created_at, revoked, user_agent, last_used_at, ip_address) VALUES (?, ?, ?, 0, ?, ?, ?)')
      .run([jti, user.id, now, req.headers['user-agent'] || null, now, ip]);

    // Admin tokens are time-bounded (hard JWT expiry on top of the revocable
    // session row). 12h ≈ one working day; on expiry the panel receives 401 and
    // drops back to the login screen (see public/admin/admin.js).
    const token = sign({ sub: user.id, jti }, { expiresIn: '12h' });
    res.json({ token });
  } catch (err) {
    next(err);
  }
});

// ── Auth gate for everything below ──────────────────────────────────────────
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

// ── Sub-routers (all inherit authMiddleware + isAdmin above) ────────────────
router.use(require('./admin/stats'));
router.use(require('./admin/users'));
router.use(require('./admin/chats'));
router.use(require('./admin/moderation'));
router.use(require('./admin/stickerRepair'));
router.use(require('./admin/diagnostics'));

module.exports = router;
