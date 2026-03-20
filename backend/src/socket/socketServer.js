/**
 * socketServer.js
 *
 * Real-time layer: authenticates socket connections and manages:
 *   - Per-user rooms  (user:<id>)  for direct delivery
 *   - Per-chat rooms  (chat:<id>)  for broadcast
 *   - Online presence tracking
 *   - Typing indicators
 *
 * Imports:
 *   chatService    → getUserChats (load user's rooms on connect)
 *   messageService → saveMessage  (reserved for future server-side message ops)
 */

const { Server } = require('socket.io');
const { verify } = require('../utils/jwt');
const { getDb } = require('../config/database');
const { getUserChats } = require('../services/chatService');
const { saveMessage } = require('../services/messageService');

// Track which userIds are currently connected
const onlineUsers = new Set();

// Track which chat each user currently has open (userId → chatId | null)
const userActiveChat = new Map();

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // ── Auth middleware ─────────────────────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token'));

    let payload;
    try {
      payload = verify(token);
    } catch {
      return next(new Error('Invalid token'));
    }

    const session = getDb()
      .prepare('SELECT id, revoked FROM sessions WHERE id = ?')
      .get(payload.jti);

    if (!session || session.revoked) return next(new Error('Session revoked'));

    socket.data.userId = payload.sub;
    next();
  });

  // ── Connection handler ──────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    onlineUsers.add(userId);
    console.log(`[Socket] Connected: ${userId}`);

    // Load user's chats — used for room joins and presence notifications
    const userChats = getUserChats(userId);

    // Update last seen
    getDb()
      .prepare('UPDATE users SET last_seen_at = ? WHERE id = ?')
      .run([Date.now(), userId]);

    // Join personal room (for events targeted to this user specifically)
    socket.join(`user:${userId}`);

    // Join all chat rooms and announce online presence
    userChats.forEach(chat => {
      socket.join(`chat:${chat.id}`);
      socket.to(`chat:${chat.id}`).emit('user-online', { userId });
    });

    // Inform connecting user which of their contacts are already online
    const seenMembers = new Set();
    userChats.forEach(chat => {
      chat.members.forEach(m => {
        if (m.id !== userId && !seenMembers.has(m.id) && onlineUsers.has(m.id)) {
          socket.emit('user-online', { userId: m.id });
          seenMembers.add(m.id);
        }
      });
    });

    // ── Events ───────────────────────────────────────────────────────────────

    // Join a specific chat room (called after creating a new chat on the client)
    socket.on('join-chat', chatId => {
      socket.join(`chat:${chatId}`);
    });

    // Track which chat the user currently has open (for read-state / push suppression)
    socket.on('set-active-chat', chatId => {
      userActiveChat.set(userId, chatId || null);
    });

    // Typing indicators
    socket.on('typing-start', ({ chatId }) => {
      socket.to(`chat:${chatId}`).emit('user-typing', { userId, chatId });
    });
    socket.on('typing-stop', ({ chatId }) => {
      socket.to(`chat:${chatId}`).emit('user-stopped-typing', { userId, chatId });
    });

    // ── Disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      onlineUsers.delete(userId);
      userActiveChat.delete(userId);
      const lastSeenAt = Date.now();
      getDb()
        .prepare('UPDATE users SET last_seen_at = ? WHERE id = ?')
        .run([lastSeenAt, userId]);
      userChats.forEach(chat => {
        io.to(`chat:${chat.id}`).emit('user-offline', { userId, last_seen_at: lastSeenAt });
      });
      console.log(`[Socket] Disconnected: ${userId}`);
    });
  });

  return io;
}

module.exports = { initSocket, onlineUsers, userActiveChat };
