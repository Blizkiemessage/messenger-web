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
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../middleware/auth');
const { getChatMessages, saveMessage, toggleReaction, toggleEmojiReaction, deleteMessages, hideMessages, pinMessage, unpinMessage, getPinnedMessages, forwardMessages, editMessage } = require('../services/messageService');
const { isBlocked } = require('../services/userService');
const { getDb } = require('../config/database');
const { signUrl, signMessageUrls } = require('../utils/s3Sign');
const { parsePagination } = require('../utils/pagination');

const router = express.Router();
router.use(authMiddleware);

const msgLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many messages, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /chats/:chatId/messages
router.get('/:chatId/messages', async (req, res, next) => {
  try {
    const { limit, before } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });
    const messages = getChatMessages(req.params.chatId, req.userId, { limit, before });
    await signMessageUrls(messages);
    res.json(messages);
  } catch (err) { next(err); }
});

// POST /chats/:chatId/messages
router.post('/:chatId/messages', msgLimiter, async (req, res, next) => {
  try {
    const { text, attachment_url, attachment_type, attachment_name, attachment_meta, attachment_duration, reply } = req.body;
    const hasText = text && typeof text === 'string' && text.trim();
    const hasAttachment = attachment_url && attachment_type;
    if (!hasText && !hasAttachment) {
      return res.status(400).json({ error: 'text or attachment is required' });
    }
    if (hasText && text.length > 4000) {
      return res.status(400).json({ error: 'Message text max 4000 chars' });
    }

    // Validate reply object if provided
    const replyData = (reply && typeof reply.id === 'string') ? reply : null;

    const attachment = hasAttachment ? {
      attachment_url, attachment_type, attachment_name,
      attachment_meta: typeof attachment_meta === 'string' ? attachment_meta : null,
      attachment_duration: typeof attachment_duration === 'number' && attachment_duration > 0 ? attachment_duration : null,
    } : {};

    // Block check: for DM chats, reject if the recipient has blocked the sender
    const db2 = getDb();
    const chat = db2.prepare('SELECT type FROM chats WHERE id = ?').get(req.params.chatId);
    if (chat?.type === 'direct') {
      const recipient = db2.prepare(
        'SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?'
      ).get([req.params.chatId, req.userId]);
      if (recipient && isBlocked(recipient.user_id, req.userId)) {
        return res.status(403).json({ error: 'blocked' });
      }
    }

    const msg = saveMessage(req.params.chatId, req.userId, hasText ? text.trim() : '', attachment, false, replyData);

    // Sign the attachment URL once — same signed URL is broadcast to all members
    if (msg.attachment_url) msg.attachment_url = await signUrl(msg.attachment_url);

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

    // Fire-and-forget push to offline members
    const { fireAndForgetPush } = require('../services/pushService');
    fireAndForgetPush(req.params.chatId, req.userId, {
      text:            hasText ? text.trim() : '',
      attachment_type: attachment_type || null,
      attachment_meta: (typeof attachment_meta === 'string' ? attachment_meta : null),
    }, io);

    res.status(201).json(msg);
  } catch (err) { next(err); }
});

// DELETE /chats/:chatId/messages — delete messages for everyone or hide for self only
router.delete('/:chatId/messages', (req, res, next) => {
  try {
    const { messageIds, forEveryone = true } = req.body;
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: 'messageIds array is required' });
    }

    const io = req.app.get('io');

    if (forEveryone) {
      // Soft-delete globally, broadcast to all chat members
      const deleted = deleteMessages(req.params.chatId, req.userId, messageIds);
      if (io && deleted.length > 0) {
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
    } else {
      // Hide only for the requesting user, emit only to them
      const hidden = hideMessages(req.userId, req.params.chatId, messageIds);
      if (io && hidden.length > 0) {
        io.to(`user:${req.userId}`).emit('messages-deleted', {
          chatId: req.params.chatId,
          messageIds: hidden,
        });
      }
      res.json({ ok: true, deleted: hidden });
    }
  } catch (err) { next(err); }
});

// PATCH /chats/:chatId/messages/:msgId — edit a message
router.patch('/:chatId/messages/:msgId', (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }
    if (text.length > 4000) {
      return res.status(400).json({ error: 'Message text max 4000 chars' });
    }
    const msg = editMessage(req.params.chatId, req.params.msgId, req.userId, text);
    const io = req.app.get('io');
    if (io) {
      const db = getDb();
      const members = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(req.params.chatId);
      for (const m of members) {
        io.to(`user:${m.user_id}`).emit('message-edited', msg);
      }
    }
    res.json(msg);
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

// POST /chats/:chatId/messages/:msgId/react2  ✅ NEW — emoji reactions
router.post('/:chatId/messages/:msgId/react2', (req, res, next) => {
  try {
    const { chatId, msgId } = req.params;
    const { emoji } = req.body;
    if (!emoji || typeof emoji !== 'string') {
      return res.status(400).json({ error: 'emoji is required' });
    }

    const db = getDb();
    const member = db
      .prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?')
      .get([chatId, req.userId]);
    if (!member) return res.status(403).json({ error: 'Forbidden' });

    const reactions = toggleEmojiReaction(msgId, req.userId, emoji);

    const io = req.app.get('io');
    if (io) {
      const members = db
        .prepare('SELECT user_id FROM chat_members WHERE chat_id = ?')
        .all(chatId);
      for (const m of members) {
        io.to(`user:${m.user_id}`).emit('message-reaction-v2', {
          messageId: msgId,
          chatId,
          reactions,
        });
      }
    }

    res.json({ reactions });
  } catch (err) { next(err); }
});

// GET /chats/:chatId/messages/pinned
router.get('/:chatId/messages/pinned', async (req, res, next) => {
  try {
    const msgs = getPinnedMessages(req.params.chatId, req.userId);
    await signMessageUrls(msgs);
    res.json(msgs);
  } catch (err) { next(err); }
});

// POST /chats/:chatId/messages/forward  ✅ NEW
router.post('/:chatId/messages/forward', async (req, res, next) => {
  try {
    const { messageIds } = req.body;
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: 'messageIds array is required' });
    }
    const messages = forwardMessages(req.params.chatId, req.userId, messageIds);

    // Sign attachment URLs on all forwarded messages at once
    await signMessageUrls(messages);

    const io = req.app.get('io');
    if (io) {
      const db = getDb();
      const members = db
        .prepare('SELECT user_id FROM chat_members WHERE chat_id = ?')
        .all(req.params.chatId);
      for (const msg of messages) {
        for (const m of members) {
          io.to(`user:${m.user_id}`).emit('new-message', msg);
        }
      }
    }
    res.status(201).json(messages);
  } catch (err) { next(err); }
});

// POST /chats/:chatId/messages/:msgId/pin
router.post('/:chatId/messages/:msgId/pin', async (req, res, next) => {
  try {
    const msg = pinMessage(req.params.chatId, req.params.msgId, req.userId);
    if (msg.attachment_url) msg.attachment_url = await signUrl(msg.attachment_url);
    const io = req.app.get('io');
    if (io) {
      const { getDb } = require('../config/database');
      const members = getDb().prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(req.params.chatId);
      for (const m of members) io.to(`user:${m.user_id}`).emit('message-pinned', { chatId: req.params.chatId, message: msg });
    }
    res.json(msg);
  } catch (err) { next(err); }
});

// DELETE /chats/:chatId/messages/:msgId/pin
router.delete('/:chatId/messages/:msgId/pin', (req, res, next) => {
  try {
    unpinMessage(req.params.chatId, req.params.msgId, req.userId);
    const io = req.app.get('io');
    if (io) {
      const { getDb } = require('../config/database');
      const members = getDb().prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(req.params.chatId);
      for (const m of members) io.to(`user:${m.user_id}`).emit('message-unpinned', { chatId: req.params.chatId, messageId: req.params.msgId });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /chats/:chatId/messages/:msgId/readers
// Returns list of members who have read past this message (last_read_at >= msg.created_at), excluding sender
router.get('/:chatId/messages/:msgId/readers', (req, res, next) => {
  try {
    const db = getDb();
    const { chatId, msgId } = req.params;
    const userId = req.userId;

    // Verify requesting user is a member
    const isMember = db.prepare(
      'SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?'
    ).get([chatId, userId]);
    if (!isMember) return res.status(403).json({ error: 'Not a member' });

    // Get the message
    const msg = db.prepare(
      'SELECT created_at, sender_id FROM messages WHERE id = ? AND chat_id = ? AND deleted_at IS NULL'
    ).get([msgId, chatId]);
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    // Query members who have read at or past this message timestamp, excluding the sender
    const rows = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.avatar_url,
             u.hide_avatar, u.avatar_exceptions, cm.last_read_at as read_at
      FROM chat_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.chat_id = ?
        AND cm.user_id != ?
        AND cm.last_read_at >= ?
      ORDER BY cm.last_read_at ASC
    `).all([chatId, msg.sender_id, msg.created_at]);

    const { sanitizeUser } = require('../services/userService');
    res.json(rows.map(r => ({
      user: sanitizeUser(r, { viewerId: userId }),
      read_at: r.read_at,
    })));
  } catch (err) { next(err); }
});

module.exports = router;
