/**
 * routes/notes.js
 *
 * F4: Shared notes per chat.
 * Any chat member can read and write; deletion rules depend on chat type.
 *
 * Routes:
 *   GET    /chats/:chatId/notes              — list all notes for a chat
 *   POST   /chats/:chatId/notes              — create a new note
 *   PUT    /chats/:chatId/notes/:noteId      — update title/content (any member)
 *   DELETE /chats/:chatId/notes/:noteId      — delete (group: admin/mod; direct: any member)
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../middleware/auth');
const { getDb } = require('../config/database');

const router = express.Router();
router.use(authMiddleware);

const notesLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Helper: verify membership and return member role
function getMembership(chatId, userId) {
  const db = getDb();
  return db.prepare(
    'SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?'
  ).get([chatId, userId]);
}

// Helper: hydrate note with editor display name
function hydrateNote(note) {
  if (!note) return null;
  const db = getDb();
  let last_edited_by_name = null;
  if (note.last_edited_by) {
    const u = db.prepare('SELECT display_name, username FROM users WHERE id = ?').get(note.last_edited_by);
    last_edited_by_name = u?.display_name || u?.username || null;
  }
  return { ...note, last_edited_by_name };
}

// GET /chats/:chatId/notes
router.get('/:chatId/notes', async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const membership = getMembership(chatId, req.userId);
    if (!membership) return res.status(403).json({ error: 'Not a member' });

    const db = getDb();
    const notes = db.prepare(
      'SELECT * FROM chat_notes WHERE chat_id = ? ORDER BY created_at DESC'
    ).all(chatId);

    res.json(notes.map(hydrateNote));
  } catch (err) { next(err); }
});

// POST /chats/:chatId/notes
router.post('/:chatId/notes', notesLimiter, async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const membership = getMembership(chatId, req.userId);
    if (!membership) return res.status(403).json({ error: 'Not a member' });

    let { title } = req.body;
    title = typeof title === 'string' && title.trim() ? title.trim().slice(0, 200) : 'Заметка';

    const db = getDb();
    const now = Date.now();
    const id = uuidv4();

    db.prepare(`
      INSERT INTO chat_notes (id, chat_id, title, content, last_edited_by, last_edited_at, created_at)
      VALUES (?, ?, ?, '', ?, ?, ?)
    `).run([id, chatId, title, req.userId, now, now]);

    const note = hydrateNote(db.prepare('SELECT * FROM chat_notes WHERE id = ?').get(id));

    const io = req.app.get('io');
    if (io) io.to(`chat:${chatId}`).emit('note:created', { chatId, note });

    res.status(201).json(note);
  } catch (err) { next(err); }
});

// PUT /chats/:chatId/notes/:noteId
router.put('/:chatId/notes/:noteId', notesLimiter, async (req, res, next) => {
  try {
    const { chatId, noteId } = req.params;
    const membership = getMembership(chatId, req.userId);
    if (!membership) return res.status(403).json({ error: 'Not a member' });

    const db = getDb();
    const existing = db.prepare('SELECT * FROM chat_notes WHERE id = ? AND chat_id = ?').get([noteId, chatId]);
    if (!existing) return res.status(404).json({ error: 'Note not found' });

    let { title, content } = req.body;
    const newTitle = typeof title === 'string' ? title.trim().slice(0, 200) || existing.title : existing.title;
    const newContent = typeof content === 'string' ? content.slice(0, 50000) : existing.content;

    const now = Date.now();
    db.prepare(`
      UPDATE chat_notes
      SET title = ?, content = ?, last_edited_by = ?, last_edited_at = ?
      WHERE id = ?
    `).run([newTitle, newContent, req.userId, now, noteId]);

    const note = hydrateNote(db.prepare('SELECT * FROM chat_notes WHERE id = ?').get(noteId));

    const io = req.app.get('io');
    if (io) {
      // Broadcast to all members except the sender to avoid echo (sender already has updated state)
      io.to(`chat:${chatId}`).emit('note:updated', { chatId, note });
    }

    res.json(note);
  } catch (err) { next(err); }
});

// DELETE /chats/:chatId/notes/:noteId
router.delete('/:chatId/notes/:noteId', notesLimiter, async (req, res, next) => {
  try {
    const { chatId, noteId } = req.params;
    const db = getDb();

    const membership = getMembership(chatId, req.userId);
    if (!membership) return res.status(403).json({ error: 'Not a member' });

    const existing = db.prepare('SELECT * FROM chat_notes WHERE id = ? AND chat_id = ?').get([noteId, chatId]);
    if (!existing) return res.status(404).json({ error: 'Note not found' });

    const chat = db.prepare('SELECT type FROM chats WHERE id = ?').get(chatId);

    // Permission check: group chats require admin/mod; direct/saved allow any member
    if (chat?.type === 'group') {
      if (membership.role !== 'admin' && membership.role !== 'moderator') {
        return res.status(403).json({ error: 'Only admins and moderators can delete notes in group chats' });
      }
    }

    db.prepare('DELETE FROM chat_notes WHERE id = ?').run(noteId);

    const io = req.app.get('io');
    if (io) io.to(`chat:${chatId}`).emit('note:deleted', { chatId, noteId });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
