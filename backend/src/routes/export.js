const { Router }        = require('express');
const archiver          = require('archiver');
const { getDb }         = require('../config/database');
const { decrypt }       = require('../crypto/aes');
const { authMiddleware }= require('../middleware/auth');

const router = Router();
router.use(authMiddleware);

// TODO: вернуть rate limit (1 экспорт/час) после тестирования
// const exportLimiter = rateLimit({
//   windowMs: 3_600_000, max: 1,
//   keyGenerator: req => `export:${req.userId}`,
//   standardHeaders: true, legacyHeaders: false,
//   message: { error: 'Слишком много запросов. Экспорт доступен раз в час.' },
// });

/**
 * GET /export/my-data
 * Streams a ZIP archive containing all personal data for the requesting user:
 *   profile.json, friends.json, sessions.json, chats/<name>-<id>.json
 */
router.get('/my-data', (req, res, next) => {
  try {
    const db     = getDb();
    const userId = req.userId;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="blizkie-export-${Date.now()}.zip"`,
    );

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', err => next(err));
    archive.pipe(res);

    // ── Profile ─────────────────────────────────────────────────────────────
    const user = db.prepare(`
      SELECT id, username, email, display_name, bio, avatar_url, created_at
      FROM users WHERE id = ?
    `).get(userId);
    archive.append(JSON.stringify(user, null, 2), { name: 'profile.json' });

    // ── Friends ─────────────────────────────────────────────────────────────
    const friends = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.avatar_url,
             f.created_at AS friends_since
      FROM friends f
      JOIN users u ON u.id = CASE
        WHEN f.user_a_id = ? THEN f.user_b_id
        ELSE f.user_a_id
      END
      WHERE f.user_a_id = ? OR f.user_b_id = ?
      ORDER BY f.created_at
    `).all(userId, userId, userId);
    archive.append(JSON.stringify(friends, null, 2), { name: 'friends.json' });

    // ── Sessions history ─────────────────────────────────────────────────────
    const sessions = db.prepare(`
      SELECT id, ip_address, user_agent, created_at, last_used_at, revoked
      FROM sessions WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(userId);
    archive.append(JSON.stringify(sessions, null, 2), { name: 'sessions.json' });

    // ── Chats + messages ─────────────────────────────────────────────────────
    const chats = db.prepare(`
      SELECT c.id, c.type, c.name, c.created_at
      FROM chats c
      JOIN chat_members cm ON cm.chat_id = c.id
      WHERE cm.user_id = ?
      ORDER BY c.created_at
    `).all(userId);

    for (const chat of chats) {
      const messages = db.prepare(`
        SELECT m.id, m.sender_id, u.username AS sender_name,
               m.ciphertext, m.iv, m.auth_tag,
               m.attachment_type, m.attachment_url, m.attachment_name,
               m.reply_to_id, m.created_at
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.chat_id = ? AND m.deleted_at IS NULL
        ORDER BY m.created_at
      `).all(chat.id);

      const rows = messages.map(msg => {
        let text = null;
        if (msg.ciphertext) {
          try {
            text = decrypt({ ciphertext: msg.ciphertext, iv: msg.iv, authTag: msg.auth_tag });
          } catch {
            text = '[зашифровано]';
          }
        }
        return {
          id:            msg.id,
          sender:        msg.sender_name,
          text,
          type:          msg.attachment_type  || null,
          attachmentUrl: msg.attachment_url  || null,
          attachmentName:msg.attachment_name || null,
          replyToId:     msg.reply_to_id     || null,
          createdAt:     new Date(msg.created_at).toISOString(),
        };
      });

      // sanitise filename: keep letters, digits, dash, underscore, dot
      const safeName = (chat.name || `direct-${chat.id}`)
        .replace(/[^\wЀ-ӿ._-]/g, '_')
        .slice(0, 60);

      archive.append(JSON.stringify(rows, null, 2), {
        name: `chats/${safeName}-${chat.id}.json`,
      });
    }

    archive.finalize();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
