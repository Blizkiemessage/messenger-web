/**
 * routes/messages.js
 *
 * Message endpoints — all operations on messages within a chat.
 * Business logic lives in messageService.
 *
 * Routes:
 *   GET    /chats/:chatId/messages              — paginated history
 *   POST   /chats/:chatId/messages              — send a message
 *   DELETE /chats/:chatId/messages              — bulk soft-delete own messages
 *   POST   /chats/:chatId/messages/:msgId/react — toggle like reaction
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { getChatMessages, saveMessage, toggleReaction, deleteMessages } = require('../services/messageService');
const { getDb } = require('../config/database');

const router = express.Router();
router.use(authMiddleware);

// GET /chats/:chatId/messages
router.get('/:chatId/messages', (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before ? parseInt(req.query.before) : null;
    const messages = getChatMessages(req.params.chatId, req.userId, { limit, before });
    res.json(messages);
  } catch (err) { next(err); }
});

// POST /chats/:chatId/messages
router.post('/:chatId/messages', (req, res, next) => {
  try {
    const { text, attachment_url, attachment_type, attachment_name } = req.body;
    const hasText = text && typeof text === 'string' && text.trim();
    const hasAttachment = attachment_url && attachment_type;
    if (!hasText && !hasAttachment) {
      return res.status(400).json({ error: 'text or attachment is required' });
    }

    const attachment = hasAttachment ? { attachment_url, attachment_type, attachment_name } : {};
    const msg = saveMessage(req.params.chatId, req.userId, hasText ? text.trim() : '', attachment);

    const db = getDb();
    const members = db
      .prepare('SELECT u.id FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ?')
      .all(req.params.chatId);

    const io = req.app.get('io');
    if (io) {
      for (const member of members) {
        io.to(`user:${member.id}`).emit('new-message', msg);
      }
    }

    res.status(201).json(msg);
  } catch (err) { next(err); }
});

// DELETE /chats/:chatId/messages — bulk soft-delete own messages
router.delete('/:chatId/messages', (req, res, next) => {
  try {
    const { messageIds } = req.body;
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: 'messageIds array is required' });
    }

    const deleted = deleteMessages(req.params.chatId, req.userId, messageIds);

    const io = req.app.get('io');
    if (io) {
      const db = getDb();
      const members = db
        .prepare('SELECT u.id FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ?')
        .all(req.params.chatId);
      for (const member of members) {
        io.to(`user:${member.id}`).emit('messages-deleted', {
          chatId: req.params.chatId,
          messageIds: deleted,
        });
      }
    }

    res.json({ ok: true, deleted });
  } catch (err) { next(err); }
});

// POST /chats/:chatId/messages/:msgId/react
router.post('/:chatId/messages/:msgId/react', (req, res, next) => {
  try {
    const { chatId, msgId } = req.params;
    const db = getDb();

    const member = db
      .prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?')
      .get([chatId, req.userId]);
    if (!member) return res.status(403).json({ error: 'Forbidden' });

    const likedBy = toggleReaction(msgId, req.userId);

    const io = req.app.get('io');
    if (io) {
      const members = db
        .prepare('SELECT user_id FROM chat_members WHERE chat_id = ?')
        .all(chatId);
      for (const m of members) {
        io.to(`user:${m.user_id}`).emit('message-reaction', { messageId: msgId, chatId, liked_by: likedBy });
      }
    }

    res.json({ liked_by: likedBy });
  } catch (err) { next(err); }
});

module.exports = router;
