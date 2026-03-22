const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const {
  getUserChats,
  getOrCreateDirectChat,
  createGroupChat,
  getChatById,
  markChatAsRead,
  addChatMember,
  removeChatMember,
  updateChatMetadata,
  leaveGroup,
  closeGroup,
  transferAdmin,
  deleteDirectChat,
} = require('../services/chatService');

const router = express.Router();
router.use(authMiddleware);

// GET /chats — list all chats for current user
router.get('/', (req, res) => {
  const chats = getUserChats(req.userId);
  res.json(chats);
});

// POST /chats — create or get a direct chat with another user
router.post('/', (req, res, next) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    if (userId === req.userId) {
      return res.status(400).json({ error: 'Cannot chat with yourself' });
    }

    const { getDb } = require('../config/database');
    const db = getDb();

    const existing = db.prepare(
      `SELECT c.id FROM chats c
       JOIN chat_members cm1 ON cm1.chat_id = c.id AND cm1.user_id = ?
       JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id = ?
       WHERE c.type = 'direct' LIMIT 1`
    ).get([req.userId, userId]);

    const isNew = !existing;
    const chat = getOrCreateDirectChat(req.userId, userId);

    if (isNew) {
      const io = req.app.get('io');
      if (io) {
        for (const member of chat.members) {
          io.to(`user:${member.id}`).emit('chat-created', chat);
        }
      }
    }

    res.json(chat);
  } catch (err) {
    next(err);
  }
});

// POST /chats/group — create a group chat
router.post('/group', (req, res, next) => {
  try {
    const { name, memberIds, description } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!Array.isArray(memberIds) || memberIds.length < 1) {
      return res.status(400).json({ error: 'Добавьте хотя бы одного участника' });
    }
    const chat = createGroupChat(name, req.userId, memberIds, description || null);

    const io = req.app.get('io');
    if (io) {
      for (const member of chat.members) {
        io.to(`user:${member.id}`).emit('chat-created', chat);
      }
    }

    res.json(chat);
  } catch (err) {
    next(err);
  }
});

// GET /chats/:id
router.get('/:id', (req, res) => {
  const chat = getChatById(req.params.id, req.userId);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  res.json(chat);
});

// POST /chats/:id/read — mark all messages in chat as read
router.post('/:id/read', (req, res, next) => {
  try {
    const readAt = markChatAsRead(req.params.id, req.userId);
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${req.params.id}`).emit('chat-read', {
        chatId: req.params.id,
        userId: req.userId,
        readAt,
      });
    }
    res.json({ ok: true, readAt });
  } catch (err) {
    next(err);
  }
});

// POST /chats/:id/members — add a member (creator only)
router.post('/:id/members', (req, res, next) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const updatedChat = addChatMember(req.params.id, req.userId, userId);
    const io = req.app.get('io');
    if (io) {
      for (const member of updatedChat.members) {
        io.to(`user:${member.id}`).emit('chat-updated', updatedChat);
      }
      io.to(`user:${userId}`).emit('chat-created', updatedChat);
    }
    res.json(updatedChat);
  } catch (err) {
    next(err);
  }
});

// DELETE /chats/:id/members/:userId — remove a member (creator only)
router.delete('/:id/members/:userId', (req, res, next) => {
  try {
    const { updatedChat, sysMsg, remaining } = removeChatMember(req.params.id, req.userId, req.params.userId);
    const io = req.app.get('io');
    if (io) {
      for (const member of updatedChat.members) {
        io.to(`user:${member.id}`).emit('chat-updated', updatedChat);
      }
      if (sysMsg) {
        for (const uid of remaining) {
          io.to(`user:${uid}`).emit('new-message', sysMsg);
        }
      }
      io.to(`user:${req.params.userId}`).emit('chat-removed', { chatId: req.params.id });
    }
    res.json(updatedChat);
  } catch (err) {
    next(err);
  }
});

// POST /chats/:id/leave — leave a group
// ✅ If requester is the admin → closes group instead of leaving
router.post('/:id/leave', (req, res, next) => {
  try {
    const { sysMsg, remaining, closed } = leaveGroup(req.params.id, req.userId);
    const io = req.app.get('io');
    if (io) {
      if (closed) {
        // Admin closed the group — broadcast updated chat to all members (including admin)
        const updatedChat = getChatById(req.params.id, req.userId);
        for (const uid of remaining) {
          io.to(`user:${uid}`).emit('chat-updated', updatedChat);
          if (sysMsg) io.to(`user:${uid}`).emit('new-message', sysMsg);
        }
      } else {
        // Regular leave — remove chat for leaver, send system message to remaining
        io.to(`user:${req.userId}`).emit('chat-removed', { chatId: req.params.id });
        if (sysMsg) {
          for (const uid of remaining) {
            io.to(`user:${uid}`).emit('new-message', sysMsg);
          }
        }
      }
    }
    res.json({ ok: true, closed });
  } catch (err) { next(err); }
});

// ✅ NEW: POST /chats/:id/close — admin explicitly closes the group
router.post('/:id/close', (req, res, next) => {
  try {
    const { sysMsg, allMembers } = closeGroup(req.params.id, req.userId);
    const io = req.app.get('io');
    if (io) {
      const updatedChat = getChatById(req.params.id, req.userId);
      for (const uid of allMembers) {
        io.to(`user:${uid}`).emit('chat-updated', updatedChat);
        if (sysMsg) io.to(`user:${uid}`).emit('new-message', sysMsg);
      }
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ✅ NEW: POST /chats/:id/transfer-admin — transfer admin rights to another member
router.post('/:id/transfer-admin', (req, res, next) => {
  try {
    const { newAdminId } = req.body;
    if (!newAdminId) return res.status(400).json({ error: 'newAdminId is required' });

    const { sysMsg, allMembers, updatedChat } = transferAdmin(req.params.id, req.userId, newAdminId);
    const io = req.app.get('io');
    if (io) {
      for (const uid of allMembers) {
        io.to(`user:${uid}`).emit('chat-updated', updatedChat);
        if (sysMsg) io.to(`user:${uid}`).emit('new-message', sysMsg);
      }
    }
    res.json(updatedChat);
  } catch (err) { next(err); }
});

// DELETE /chats/:id — delete direct chat (removes for both users)
router.delete('/:id', (req, res, next) => {
  try {
    const memberIds = deleteDirectChat(req.params.id, req.userId);
    const io = req.app.get('io');
    if (io) {
      for (const uid of memberIds) {
        io.to(`user:${uid}`).emit('chat-removed', { chatId: req.params.id });
      }
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PATCH /chats/:id — update chat metadata (name, description, avatar)
router.patch('/:id', (req, res, next) => {
  try {
    const { name, description, avatar_url } = req.body;
    const updatedChat = updateChatMetadata(req.params.id, req.userId, { name, description, avatar_url });

    const io = req.app.get('io');
    if (io) {
      for (const member of updatedChat.members) {
        io.to(`user:${member.id}`).emit('chat-updated', updatedChat);
      }
    }

    res.json(updatedChat);
  } catch (err) { next(err); }
});

// PATCH /chats/:id/avatar — update group avatar with system message
router.patch('/:id/avatar', (req, res, next) => {
  try {
    const { avatar_url } = req.body;
    if (!avatar_url) return res.status(400).json({ error: 'avatar_url is required' });

    const updatedChat = updateChatMetadata(req.params.id, req.userId, { avatar_url });

    // Send system message to group
    const { saveMessage } = require('../services/messageService');
    const sysMsg = saveMessage(req.params.id, req.userId, 'Администратор изменил(а) фото группы', {}, true);

    const io = req.app.get('io');
    if (io) {
      for (const member of updatedChat.members) {
        io.to(`user:${member.id}`).emit('chat-updated', updatedChat);
        io.to(`user:${member.id}`).emit('new-message', sysMsg);
      }
    }

    res.json(updatedChat);
  } catch (err) { next(err); }
});

module.exports = router;
