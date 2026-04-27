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
const { saveMessage, deliverPendingMessages } = require('../services/messageService');
const { corsOriginCallback } = require('../utils/corsOrigin');
const { clearExpiredPresenceStatuses } = require('../services/userService');

// Track active socket count per user: userId → number.
// A user is online as long as count > 0; goes offline only when the last socket disconnects.
// This fixes the multi-tab/multi-device "presence flicker" bug where disconnecting one
// tab incorrectly marked the user offline while other tabs were still open.
const onlineUsers = new Map();

// ── E3: In-flight WebRTC calls ─────────────────────────────────────────────────
// callId → { callerId, calleeId, chatId, callType, createdAt, startedAt? }
const activeCalls = new Map();

function saveCallRecord(callId, call, status, endedAt = null, duration = null) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT OR IGNORE INTO calls
        (id, chat_id, caller_id, callee_id, call_type, status, started_at, ended_at, duration, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run([
      callId, call.chatId, call.callerId, call.calleeId,
      call.callType, status, call.startedAt || null,
      endedAt, duration, Date.now(),
    ]);
  } catch (err) {
    console.error('[Call] saveCallRecord error:', err.message);
  }
}

// Track which chat each socket currently has open (socketId → chatId | null).
// Keyed by socketId (not userId) so each tab can independently set its active chat.
const userActiveChat = new Map();

// Per-socket typing throttle: Map<"socketId:chatId", lastEmitTimestamp>
// Prevents flooding — typing-start is suppressed if < TYPING_THROTTLE_MS since last emit.
// Cleaned up on disconnect to avoid unbounded growth.
const typingThrottle = new Map();
const TYPING_THROTTLE_MS = 1500;

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOriginCallback,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // ── Auth middleware ─────────────────────────────────────────────────────────
  io.use((socket, next) => {
    // Try HttpOnly cookie first, then fall back to auth.token (legacy / admin panel)
    const cookieHeader = socket.handshake.headers.cookie || '';
    const cookieToken = cookieHeader.split(';')
      .map(c => c.trim())
      .find(c => c.startsWith('session='))
      ?.slice('session='.length)
      .trim() || null;
    const token = cookieToken || socket.handshake.auth?.token || null;

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
    const prevCount = onlineUsers.get(userId) || 0;
    onlineUsers.set(userId, prevCount + 1);
    const isFirstSocket = prevCount === 0;
    console.log(`[Socket] Connected: ${userId} (sockets: ${prevCount + 1})`);

    // Load user's chats — used for room joins and presence notifications
    const userChats = getUserChats(userId);

    // Update last seen
    getDb()
      .prepare('UPDATE users SET last_seen_at = ? WHERE id = ?')
      .run([Date.now(), userId]);

    // Join personal room (for events targeted to this user specifically)
    socket.join(`user:${userId}`);

    // Join all chat rooms; broadcast user-online only on the first socket connection
    // to avoid duplicate presence events when the same user opens a second tab.
    userChats.forEach(chat => {
      socket.join(`chat:${chat.id}`);
      if (isFirstSocket) {
        socket.to(`chat:${chat.id}`).emit('user-online', { userId });
      }
    });

    // Inform connecting user which of their contacts are already online
    const seenMembers = new Set();
    userChats.forEach(chat => {
      chat.members.forEach(m => {
        if (m.id !== userId && !seenMembers.has(m.id) && (onlineUsers.get(m.id) || 0) > 0) {
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

    // Track which chat this socket currently has open (for read-state / push suppression).
    // Keyed by socket.id so each tab tracks its own active chat independently.
    socket.on('set-active-chat', chatId => {
      userActiveChat.set(socket.id, chatId || null);
    });

    // Typing indicators — throttled to prevent event flooding
    socket.on('typing-start', ({ chatId }) => {
      if (!chatId) return;
      const key = `${socket.id}:${chatId}`;
      const now = Date.now();
      if (now - (typingThrottle.get(key) || 0) < TYPING_THROTTLE_MS) return;
      typingThrottle.set(key, now);
      socket.to(`chat:${chatId}`).emit('user-typing', { userId, chatId });
    });
    socket.on('typing-stop', ({ chatId }) => {
      if (!chatId) return;
      // Always let stop through (important for UX); clean up throttle entry
      typingThrottle.delete(`${socket.id}:${chatId}`);
      socket.to(`chat:${chatId}`).emit('user-stopped-typing', { userId, chatId });
    });

    // ── E3: WebRTC Call Signaling ──────────────────────────────────────────────

    // CALLER → Server: initiate a call to another user
    socket.on('call:invite', ({ callId, calleeId, chatId, callType }) => {
      if (!callId || !calleeId || !chatId) return;
      if (activeCalls.has(callId)) return; // duplicate

      // Reject if caller is already in a call
      const callerBusy = [...activeCalls.values()].some(
        c => c.callerId === userId || c.calleeId === userId
      );
      if (callerBusy) {
        socket.emit('call:error', { callId, reason: 'already_in_call' });
        return;
      }

      // Reject if callee is already in a call
      const calleeBusy = [...activeCalls.values()].some(
        c => c.callerId === calleeId || c.calleeId === calleeId
      );
      if (calleeBusy) {
        socket.emit('call:busy', { callId });
        return;
      }

      // Verify callee is a member of the chat (security check)
      try {
        const db = getDb();
        const callerMember = db.prepare(
          'SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?'
        ).get([chatId, userId]);
        const calleeMember = db.prepare(
          'SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?'
        ).get([chatId, calleeId]);
        if (!callerMember || !calleeMember) {
          socket.emit('call:error', { callId, reason: 'not_member' });
          return;
        }

        const callerInfo = db.prepare(
          'SELECT id, username, display_name, avatar_url FROM users WHERE id = ?'
        ).get(userId);

        activeCalls.set(callId, {
          callerId: userId, calleeId, chatId,
          callType: callType || 'audio',
          createdAt: Date.now(), startedAt: null,
        });

        io.to(`user:${calleeId}`).emit('call:incoming', {
          callId, callerId: userId, chatId,
          callType: callType || 'audio',
          callerInfo,
        });

        // ── Server-side safety timeout ───────────────────────────────────────
        // If the call never reaches 'connected' state within 90 s (e.g. both
        // parties stall in ICE negotiation), force-end it so neither side hangs
        // forever in "calling…" / "connecting…" state.
        setTimeout(() => {
          const call = activeCalls.get(callId);
          if (!call) return; // already ended normally
          if (call.startedAt) return; // call connected — let it run
          activeCalls.delete(callId);
          saveCallRecord(callId, call, 'missed');
          io.to(`user:${call.callerId}`).emit('call:ended', { callId, duration: 0 });
          io.to(`user:${call.calleeId}`).emit('call:ended', { callId, duration: 0 });
          console.log(`[Call] timeout (90 s) id=${callId} — ended as missed`);
        }, 90_000);

        console.log(`[Call] ${userId} → ${calleeId} (${callType}) id=${callId}`);
      } catch (err) {
        console.error('[Call] call:invite error:', err.message);
      }
    });

    // CALLEE → Server: accept the call
    socket.on('call:accept', ({ callId }) => {
      const call = activeCalls.get(callId);
      if (!call || call.calleeId !== userId) return;
      io.to(`user:${call.callerId}`).emit('call:accepted', { callId });
      console.log(`[Call] accepted id=${callId}`);
    });

    // CALLEE → Server: reject the call
    socket.on('call:reject', ({ callId }) => {
      const call = activeCalls.get(callId);
      if (!call || call.calleeId !== userId) return;
      activeCalls.delete(callId);
      saveCallRecord(callId, call, 'rejected');
      io.to(`user:${call.callerId}`).emit('call:rejected', { callId });
      console.log(`[Call] rejected id=${callId}`);
    });

    // CALLER → Server: relay SDP offer to callee
    socket.on('call:offer', ({ callId, sdp }) => {
      const call = activeCalls.get(callId);
      if (!call || call.callerId !== userId) return;
      io.to(`user:${call.calleeId}`).emit('call:offer', { callId, sdp });
    });

    // CALLEE → Server: relay SDP answer to caller
    socket.on('call:answer', ({ callId, sdp }) => {
      const call = activeCalls.get(callId);
      if (!call || call.calleeId !== userId) return;
      call.startedAt = Date.now();
      io.to(`user:${call.callerId}`).emit('call:answer', { callId, sdp });
    });

    // Either → Server: relay ICE candidate to the other party
    socket.on('call:ice-candidate', ({ callId, candidate }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      if (call.callerId !== userId && call.calleeId !== userId) return;
      const targetId = call.callerId === userId ? call.calleeId : call.callerId;
      io.to(`user:${targetId}`).emit('call:ice-candidate', { callId, candidate });
    });

    // Either → Server: end the call
    socket.on('call:end', ({ callId }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      if (call.callerId !== userId && call.calleeId !== userId) return;

      const endedAt  = Date.now();
      const duration = call.startedAt ? Math.floor((endedAt - call.startedAt) / 1000) : 0;
      const status   = call.startedAt ? 'ended' : 'missed';
      activeCalls.delete(callId);

      saveCallRecord(callId, call, status, endedAt, duration);

      io.to(`user:${call.callerId}`).emit('call:ended', { callId, duration });
      io.to(`user:${call.calleeId}`).emit('call:ended', { callId, duration });
      console.log(`[Call] ended id=${callId} status=${status} duration=${duration}s`);
    });

    // ── Disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      // Clean up all throttle entries for this socket to prevent unbounded Map growth
      const prefix = `${socket.id}:`;
      for (const key of typingThrottle.keys()) {
        if (key.startsWith(prefix)) typingThrottle.delete(key);
      }
      // Always clean up this socket's active-chat entry
      userActiveChat.delete(socket.id);

      const remaining = (onlineUsers.get(userId) || 1) - 1;
      if (remaining > 0) {
        // Other tabs/devices still open — stay online, don't broadcast user-offline
        onlineUsers.set(userId, remaining);
        console.log(`[Socket] Disconnected: ${userId} (sockets remaining: ${remaining})`);
        return;
      }

      // Last socket gone — end any active calls for this user
      for (const [callId, call] of activeCalls) {
        if (call.callerId === userId || call.calleeId === userId) {
          const endedAt  = Date.now();
          const duration = call.startedAt ? Math.floor((endedAt - call.startedAt) / 1000) : 0;
          const status   = call.startedAt ? 'ended' : 'missed';
          activeCalls.delete(callId);
          saveCallRecord(callId, call, status, endedAt, duration);
          const otherId = call.callerId === userId ? call.calleeId : call.callerId;
          io.to(`user:${otherId}`).emit('call:ended', { callId, duration });
        }
      }

      // Last socket gone — mark user offline
      onlineUsers.delete(userId);
      const lastSeenAt = Date.now();
      const db = getDb();
      db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run([lastSeenAt, userId]);
      // Respect hide_last_seen: don't reveal timestamp to others if user opted out
      const userRow = db.prepare('SELECT hide_last_seen FROM users WHERE id = ?').get(userId);
      const showLastSeen = !userRow?.hide_last_seen;
      userChats.forEach(chat => {
        io.to(`chat:${chat.id}`).emit('user-offline', {
          userId,
          last_seen_at: showLastSeen ? lastSeenAt : undefined,
        });
      });
      console.log(`[Socket] Disconnected: ${userId} (all sockets closed)`);
    });
  });

  // Expose onlineUsers on the io instance so REST routes can check presence
  io.onlineUsers = onlineUsers;

  // ── Periodic presence expiry check (F3) ──────────────────────────────────────
  // Every 60 seconds: find users whose status has expired, clear it in DB,
  // and notify their chat contacts in real-time.
  setInterval(() => {
    try {
      const expiredIds = clearExpiredPresenceStatuses();
      if (expiredIds.length === 0) return;
      for (const userId of expiredIds) {
        const chats = getUserChats(userId);
        const notified = new Set();
        for (const chat of chats) {
          for (const member of chat.members) {
            if (member.id !== userId && !notified.has(member.id)) {
              io.to(`user:${member.id}`).emit('presence-status-update', {
                userId,
                status: null,
                note: null,
                expires_at: null,
              });
              notified.add(member.id);
            }
          }
        }
        console.log(`[Presence] Expired status cleared for user ${userId}`);
      }
    } catch (err) {
      console.error('[Presence] Expiry check error:', err.message);
    }
  }, 60 * 1000);

  // ── F1: Scheduled message delivery job ───────────────────────────────────────
  // Every 30 seconds: find scheduled messages whose deliver_at has passed,
  // mark them delivered, increment unread counts, and broadcast via socket.
  setInterval(async () => {
    try {
      const delivered = deliverPendingMessages();
      if (delivered.length === 0) return;

      const { signUrl } = require('../utils/s3Sign');
      const db2 = getDb();

      for (const msg of delivered) {
        // Sign attachment URL so it's safe to broadcast
        if (msg.attachment_url) {
          try { msg.attachment_url = await signUrl(msg.attachment_url); } catch { /* keep original */ }
        }

        // Get chat members to broadcast to
        const members = db2
          .prepare('SELECT user_id FROM chat_members WHERE chat_id = ?')
          .all(msg.chat_id);

        for (const m of members) {
          io.to(`user:${m.user_id}`).emit('new-message', msg);
        }

        // Fire-and-forget push to offline members
        try {
          const { fireAndForgetPush } = require('../services/pushService');
          fireAndForgetPush(msg.chat_id, msg.sender_id, {
            text:            msg.text || '',
            attachment_type: msg.attachment_type || null,
            attachment_meta: msg.attachment_meta || null,
          }, io);
        } catch { /* ignore push errors */ }

        console.log(`[Scheduled] Delivered msg ${msg.id} to chat ${msg.chat_id}`);
      }
    } catch (err) {
      console.error('[Scheduled] Delivery job error:', err.message);
    }
  }, 30 * 1000);

  return io;
}

module.exports = { initSocket, onlineUsers, userActiveChat };
