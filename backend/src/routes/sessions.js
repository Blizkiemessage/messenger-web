/**
 * routes/sessions.js
 * GET  /sessions        — list active sessions (current marked is_current)
 * DELETE /sessions/:id  — revoke one session (not current)
 * DELETE /sessions      — revoke all sessions except current
 */
const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { getDb } = require('../config/database');

const router = express.Router();
router.use(authMiddleware);

function parseUA(ua) {
  if (!ua) return 'Неизвестное устройство';

  let os = 'Неизвестная ОС';
  if (/iPhone/.test(ua))       os = 'iPhone';
  else if (/iPad/.test(ua))    os = 'iPad';
  else if (/Android/.test(ua)) {
    const m = ua.match(/Android[\s/][\d.]+[;)]\s*([^;)]+)/);
    os = m ? `Android · ${m[1].trim()}` : 'Android';
  }
  else if (/Windows NT/.test(ua)) {
    const m = ua.match(/Windows NT ([\d.]+)/);
    const v = { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' }[m?.[1]] || '';
    os = `Windows${v ? ' ' + v : ''}`;
  }
  else if (/Macintosh/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua))     os = 'Linux';

  let browser = '';
  if (/Edg\//.test(ua))              browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua))   browser = 'Opera';
  else if (/Chrome\//.test(ua))      browser = 'Chrome';
  else if (/Firefox\//.test(ua))     browser = 'Firefox';
  else if (/Safari\//.test(ua))      browser = 'Safari';

  return browser ? `${os} · ${browser}` : os;
}

// GET /sessions
router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT id, created_at, last_used_at, user_agent
       FROM sessions
       WHERE user_id = ? AND revoked = 0
       ORDER BY COALESCE(last_used_at, created_at) DESC`
    ).all(req.userId);

    res.json(rows.map(s => ({
      id: s.id,
      created_at: s.created_at,
      last_used_at: s.last_used_at || s.created_at,
      device: parseUA(s.user_agent),
      is_current: s.id === req.sessionId,
    })));
  } catch (err) { next(err); }
});

// DELETE /sessions/:id — revoke one session
router.delete('/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    if (id === req.sessionId) {
      return res.status(400).json({ error: 'Нельзя завершить текущую сессию' });
    }
    const db = getDb();
    const row = db.prepare(
      'SELECT id FROM sessions WHERE id = ? AND user_id = ? AND revoked = 0'
    ).get([id, req.userId]);
    if (!row) return res.status(404).json({ error: 'Сессия не найдена' });

    db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(id);

    const io = req.app.get('io');
    if (io) io.to(`user:${req.userId}`).emit('session-revoked', { sessionId: id });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /sessions — revoke all except current
router.delete('/', (req, res, next) => {
  try {
    const db = getDb();
    const others = db.prepare(
      'SELECT id FROM sessions WHERE user_id = ? AND revoked = 0 AND id != ?'
    ).all([req.userId, req.sessionId]);

    db.prepare(
      'UPDATE sessions SET revoked = 1 WHERE user_id = ? AND revoked = 0 AND id != ?'
    ).run([req.userId, req.sessionId]);

    const io = req.app.get('io');
    if (io) {
      for (const s of others) {
        io.to(`user:${req.userId}`).emit('session-revoked', { sessionId: s.id });
      }
    }

    res.json({ ok: true, revoked: others.length });
  } catch (err) { next(err); }
});

module.exports = router;
