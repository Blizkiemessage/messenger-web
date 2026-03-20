const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { getDb } = require('../config/database');
const { sign } = require('../utils/jwt');

const router = express.Router();

// POST /admin/api/login
router.post('/login', (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (username.toLowerCase() !== 'pashaaa' || password !== '1234admin') {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    const db = getDb();
    const user = db.prepare('SELECT id FROM users WHERE LOWER(username) = ?').get('pashaaa');
    
    if (!user) {
      return res.status(404).json({ error: 'Пользователь pashaaa не найден в БД' });
    }
    
    // Create an admin token
    const token = sign({ sub: user.id, jti: 'admin-session' });
    res.json({ token });
  } catch (err) {
    next(err);
  }
});

router.use(authMiddleware);

// Middleware to ensure the user is 'pashaaa'
function isAdmin(req, res, next) {
  const db = getDb();
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.userId);
  
  if (!user || user.username.toLowerCase() !== 'pashaaa') {
    return res.status(403).json({ error: 'Access denied: Admins only' });
  }
  next();
}

router.use(isAdmin);

// GET /admin/api/stats
router.get('/stats', (req, res, next) => {
  try {
    const db = getDb();
    const usersCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const chatsCount = db.prepare('SELECT COUNT(*) as count FROM chats').get().count;
    const messagesCount = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
    res.json({ users: usersCount, chats: chatsCount, messages: messagesCount });
  } catch (err) {
    next(err);
  }
});

// GET /admin/api/users
router.get('/users', (req, res, next) => {
  try {
    const db = getDb();
    const users = db.prepare('SELECT id, username, display_name, created_at, last_seen_at FROM users').all();
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
