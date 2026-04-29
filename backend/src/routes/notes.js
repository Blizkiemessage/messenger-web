/**
 * routes/notes.js — F4: Shared notes per chat (v2 with permissions).
 *
 * Routes:
 *   GET    /chats/:chatId/notes                        — list visible notes
 *   POST   /chats/:chatId/notes                        — create note
 *   PUT    /chats/:chatId/notes/:noteId                — update title/content
 *   PATCH  /chats/:chatId/notes/:noteId/settings       — update settings (author only)
 *   DELETE /chats/:chatId/notes/:noteId                — delete note
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

function getMembership(chatId, userId) {
  const db = getDb();
  return db.prepare(
    'SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?'
  ).get([chatId, userId]);
}

function parseJson(str, fallback) {
  try { return JSON.parse(str) || fallback; } catch { return fallback; }
}

function hydrateNote(note) {
  if (!note) return null;
  const db = getDb();

  let last_edited_by_name = null;
  if (note.last_edited_by) {
    const u = db.prepare('SELECT display_name, username FROM users WHERE id = ?').get(note.last_edited_by);
    last_edited_by_name = u?.display_name || u?.username || null;
  }

  let created_by_name = null;
  if (note.created_by) {
    const u = db.prepare('SELECT display_name, username FROM users WHERE id = ?').get(note.created_by);
    created_by_name = u?.display_name || u?.username || null;
  }

  return {
    ...note,
    edit_exceptions: parseJson(note.edit_exceptions, []),
    visibility_exceptions: parseJson(note.visibility_exceptions, []),
    last_edited_by_name,
    created_by_name,
  };
}

function canSeeNote(note, userId) {
  if (!note.visibility || note.visibility === 'public') return true;
  if (note.created_by === userId) return true;
  const exceptions = parseJson(note.visibility_exceptions, []);
  return exceptions.includes(userId);
}

function canEditNote(note, userId) {
  if (!note.edit_mode || note.edit_mode === 'all') return true;
  if (note.created_by === userId) return true;
  const exceptions = parseJson(note.edit_exceptions, []);
  return exceptions.includes(userId);
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

    const visible = notes
      .filter(n => canSeeNote(n, req.userId))
      .map(hydrateNote);

    res.json(visible);
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
      INSERT INTO chat_notes
        (id, chat_id, title, content, created_by, last_edited_by, last_edited_at, created_at,
         edit_mode, edit_exceptions, visibility, visibility_exceptions)
      VALUES (?, ?, ?, '', ?, ?, ?, ?, 'all', '[]', 'public', '[]')
    `).run([id, chatId, title, req.userId, req.userId, now, now]);

    const note = hydrateNote(db.prepare('SELECT * FROM chat_notes WHERE id = ?').get(id));

    const io = req.app.get('io');
    if (io) io.to(`chat:${chatId}`).emit('note:created', { chatId, note });

    res.status(201).json(note);
  } catch (err) { next(err); }
});

// PUT /chats/:chatId/notes/:noteId — update title/content
router.put('/:chatId/notes/:noteId', notesLimiter, async (req, res, next) => {
  try {
    const { chatId, noteId } = req.params;
    const membership = getMembership(chatId, req.userId);
    if (!membership) return res.status(403).json({ error: 'Not a member' });

    const db = getDb();
    const existing = db.prepare('SELECT * FROM chat_notes WHERE id = ? AND chat_id = ?').get([noteId, chatId]);
    if (!existing) return res.status(404).json({ error: 'Note not found' });

    if (!canSeeNote(existing, req.userId)) return res.status(403).json({ error: 'Access denied' });
    if (!canEditNote(existing, req.userId)) return res.status(403).json({ error: 'Edit not allowed' });

    let { title, content } = req.body;
    const newTitle   = typeof title   === 'string' ? title.trim().slice(0, 200) || existing.title : existing.title;
    const newContent = typeof content === 'string' ? content.slice(0, 50000) : existing.content;

    const now = Date.now();
    db.prepare(`
      UPDATE chat_notes
      SET title = ?, content = ?, last_edited_by = ?, last_edited_at = ?
      WHERE id = ?
    `).run([newTitle, newContent, req.userId, now, noteId]);

    const note = hydrateNote(db.prepare('SELECT * FROM chat_notes WHERE id = ?').get(noteId));

    const io = req.app.get('io');
    if (io) io.to(`chat:${chatId}`).emit('note:updated', { chatId, note });

    res.json(note);
  } catch (err) { next(err); }
});

// PATCH /chats/:chatId/notes/:noteId/settings — author only
router.patch('/:chatId/notes/:noteId/settings', notesLimiter, async (req, res, next) => {
  try {
    const { chatId, noteId } = req.params;
    const membership = getMembership(chatId, req.userId);
    if (!membership) return res.status(403).json({ error: 'Not a member' });

    const db = getDb();
    const existing = db.prepare('SELECT * FROM chat_notes WHERE id = ? AND chat_id = ?').get([noteId, chatId]);
    if (!existing) return res.status(404).json({ error: 'Note not found' });

    if (existing.created_by !== req.userId) {
      return res.status(403).json({ error: 'Only the author can change note settings' });
    }

    const { edit_mode, edit_exceptions, visibility, visibility_exceptions } = req.body;

    const newEditMode    = ['all', 'restricted'].includes(edit_mode)  ? edit_mode  : existing.edit_mode  ?? 'all';
    const newVisibility  = ['public', 'private'].includes(visibility) ? visibility : existing.visibility ?? 'public';
    const newEditExc     = Array.isArray(edit_exceptions)        ? JSON.stringify(edit_exceptions)        : existing.edit_exceptions        ?? '[]';
    const newVisExc      = Array.isArray(visibility_exceptions)  ? JSON.stringify(visibility_exceptions)  : existing.visibility_exceptions  ?? '[]';

    db.prepare(`
      UPDATE chat_notes
      SET edit_mode = ?, edit_exceptions = ?, visibility = ?, visibility_exceptions = ?
      WHERE id = ?
    `).run([newEditMode, newEditExc, newVisibility, newVisExc, noteId]);

    const note = hydrateNote(db.prepare('SELECT * FROM chat_notes WHERE id = ?').get(noteId));

    const io = req.app.get('io');
    if (io) io.to(`chat:${chatId}`).emit('note:updated', { chatId, note });

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
    const isAuthor = existing.created_by === req.userId;

    if (chat?.type === 'group') {
      const isAdminOrMod = membership.role === 'admin' || membership.role === 'moderator';
      if (!isAdminOrMod && !isAuthor) {
        return res.status(403).json({ error: 'Only admins, moderators, or the author can delete notes' });
      }
    }

    db.prepare('DELETE FROM chat_notes WHERE id = ?').run(noteId);

    const io = req.app.get('io');
    if (io) io.to(`chat:${chatId}`).emit('note:deleted', { chatId, noteId });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
