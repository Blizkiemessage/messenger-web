/**
 * routes/folders.js — D3: Custom chat folders per user.
 *
 * Routes:
 *   GET    /folders                      — list user's folders (with chat_ids)
 *   POST   /folders                      — create folder {name, emoji}
 *   PATCH  /folders/:id                  — rename / change emoji
 *   DELETE /folders/:id                  — delete folder (cascade-removes folder_chats)
 *   POST   /folders/:id/chats            — add chat to folder {chatId}
 *   DELETE /folders/:id/chats/:chatId    — remove chat from folder
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../middleware/auth');
const { getDb } = require('../config/database');

const router = express.Router();
router.use(authMiddleware);

const foldersLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

const MAX_FOLDERS = 20;
const MAX_NAME_LEN = 64;

function getFolderWithChats(folderId) {
  const db = getDb();
  const folder = db.prepare('SELECT * FROM chat_folders WHERE id = ?').get(folderId);
  if (!folder) return null;
  const chatIds = db.prepare('SELECT chat_id FROM folder_chats WHERE folder_id = ? ORDER BY added_at ASC').all(folderId).map(r => r.chat_id);
  return { ...folder, chat_ids: chatIds };
}

// GET /folders
router.get('/', foldersLimiter, (req, res, next) => {
  try {
    const db = getDb();
    const folders = db.prepare('SELECT * FROM chat_folders WHERE user_id = ? ORDER BY sort_order ASC, id ASC').all(req.userId);
    const result = folders.map(f => {
      const chatIds = db.prepare('SELECT chat_id FROM folder_chats WHERE folder_id = ? ORDER BY added_at ASC').all(f.id).map(r => r.chat_id);
      return { ...f, chat_ids: chatIds };
    });
    res.json(result);
  } catch (err) { next(err); }
});

// POST /folders
router.post('/', foldersLimiter, (req, res, next) => {
  try {
    const db = getDb();
    const { name, emoji = '📁' } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const trimmedName = name.trim().slice(0, MAX_NAME_LEN);
    const count = db.prepare('SELECT COUNT(*) AS n FROM chat_folders WHERE user_id = ?').get(req.userId).n;
    if (count >= MAX_FOLDERS) return res.status(400).json({ error: 'Folder limit reached (max 20)' });

    const result = db.prepare(
      'INSERT INTO chat_folders (user_id, name, emoji, sort_order) VALUES (?, ?, ?, ?)'
    ).run(req.userId, trimmedName, emoji, count);

    res.status(201).json(getFolderWithChats(result.lastInsertRowid));
  } catch (err) { next(err); }
});

// PATCH /folders/:id
router.patch('/:id', foldersLimiter, (req, res, next) => {
  try {
    const db = getDb();
    const folderId = parseInt(req.params.id, 10);
    const folder = db.prepare('SELECT * FROM chat_folders WHERE id = ? AND user_id = ?').get(folderId, req.userId);
    if (!folder) return res.status(404).json({ error: 'Not found' });

    const { name, emoji } = req.body;
    const newName  = name  !== undefined ? String(name).trim().slice(0, MAX_NAME_LEN) || folder.name : folder.name;
    const newEmoji = emoji !== undefined ? String(emoji) : folder.emoji;

    db.prepare('UPDATE chat_folders SET name = ?, emoji = ? WHERE id = ?').run(newName, newEmoji, folderId);
    res.json(getFolderWithChats(folderId));
  } catch (err) { next(err); }
});

// DELETE /folders/:id
router.delete('/:id', foldersLimiter, (req, res, next) => {
  try {
    const db = getDb();
    const folderId = parseInt(req.params.id, 10);
    const folder = db.prepare('SELECT id FROM chat_folders WHERE id = ? AND user_id = ?').get(folderId, req.userId);
    if (!folder) return res.status(404).json({ error: 'Not found' });
    db.prepare('DELETE FROM chat_folders WHERE id = ?').run(folderId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /folders/:id/chats
router.post('/:id/chats', foldersLimiter, (req, res, next) => {
  try {
    const db = getDb();
    const folderId = parseInt(req.params.id, 10);
    const folder = db.prepare('SELECT id FROM chat_folders WHERE id = ? AND user_id = ?').get(folderId, req.userId);
    if (!folder) return res.status(404).json({ error: 'Not found' });

    const { chatId } = req.body;
    if (!chatId || typeof chatId !== 'string') return res.status(400).json({ error: 'chatId is required' });

    db.prepare('INSERT OR IGNORE INTO folder_chats (folder_id, chat_id) VALUES (?, ?)').run(folderId, chatId);
    res.json(getFolderWithChats(folderId));
  } catch (err) { next(err); }
});

// DELETE /folders/:id/chats/:chatId
router.delete('/:id/chats/:chatId', foldersLimiter, (req, res, next) => {
  try {
    const db = getDb();
    const folderId = parseInt(req.params.id, 10);
    const folder = db.prepare('SELECT id FROM chat_folders WHERE id = ? AND user_id = ?').get(folderId, req.userId);
    if (!folder) return res.status(404).json({ error: 'Not found' });

    db.prepare('DELETE FROM folder_chats WHERE folder_id = ? AND chat_id = ?').run(folderId, req.params.chatId);
    res.json(getFolderWithChats(folderId));
  } catch (err) { next(err); }
});

module.exports = router;
