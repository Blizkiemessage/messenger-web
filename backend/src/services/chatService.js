/**
 * chatService.js
 *
 * Chat and membership management:
 *   - getUserChats          — list all chats for a user (with last message + unread count)
 *   - createGroupChat       — create a new group chat
 *   - getOrCreateDirectChat — find or create a 1-to-1 chat
 *   - getChatById           — single chat with members + last message
 *   - markChatAsRead        — update last_read_at for a user in a chat
 *   - addChatMember         — add a user to a group (creator only)
 *   - removeChatMember      — kick a user from a group (creator only)
 *   - leaveGroup            — user voluntarily leaves a group (admin → closes group)
 *   - closeGroup            — admin explicitly closes group (from GroupInfoModal)
 *   - transferAdmin         — transfer admin rights to another member
 *   - deleteDirectChat      — delete a direct chat for both users
 *   - updateChatMetadata    — rename / re-describe a group (creator only)
 *   - deleteAccount         — full account teardown with notifications
 *
 * Depends on: userService (sanitizeUser), messageService (decryptMessage, saveMessage)
 */

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { sanitizeUser } = require('./userService');
const { deleteFromS3, deleteManyFromS3 } = require('../utils/s3Delete');
const { decryptMessage, saveMessage } = require('./messageService');

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Build a full chat object from the DB for the given user.
 * Returns null if the chat doesn't exist or the user isn't a member.
 */
function getChatById(chatId, userId) {
  const db = getDb();

  const chat = db
    .prepare(
      'SELECT id, type, name, description, avatar_url, created_at, creator_id, is_closed FROM chats WHERE id = ?'
    )
    .get(chatId);
  if (!chat) return null;

  // Fetch all members + their last_read_at + role in one query (membership check included)
  const rawMembers = db.prepare(`
    SELECT cm.last_read_at AS member_last_read_at, cm.role,
           u.id, u.username, u.display_name, u.avatar_url, u.last_seen_at,
           u.hide_avatar, u.avatar_exceptions,
           u.presence_status, u.presence_note, u.presence_expires_at
    FROM chat_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.chat_id = ?
  `).all(chatId);

  if (!rawMembers.some(m => m.id === userId)) return null;

  const otherIds = rawMembers.filter(m => m.id !== userId).map(m => m.id);

  // Batch load aliases for all other members
  const aliasMap = {};
  if (otherIds.length) {
    const phs = otherIds.map(() => '?').join(',');
    db.prepare(`SELECT target_id, alias FROM contact_aliases WHERE user_id = ? AND target_id IN (${phs})`)
      .all([userId, ...otherIds])
      .forEach(a => { aliasMap[a.target_id] = a.alias; });
  }

  // Batch load who among other members has blocked me
  const blockedByThem = new Set();
  if (otherIds.length) {
    const phs = otherIds.map(() => '?').join(',');
    db.prepare(`SELECT blocker_id FROM blocked_users WHERE blocked_id = ? AND blocker_id IN (${phs})`)
      .all([userId, ...otherIds])
      .forEach(b => blockedByThem.add(b.blocker_id));
  }

  const members = rawMembers.map(u => {
    const alias = u.id !== userId ? (aliasMap[u.id] || null) : null;
    const sanitized = sanitizeUser(u, { viewerId: userId }, alias);
    if (u.id !== userId) {
      sanitized.blocked_by_them = blockedByThem.has(u.id);
    }
    sanitized.role = u.role || 'member';
    return sanitized;
  });

  const lastMsg = db
    .prepare(
      'SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1'
    )
    .get(chatId);

  // partner_last_read_at derived from already-loaded rawMembers — no extra query
  const partner = chat.type === 'direct' ? rawMembers.find(m => m.id !== userId) : null;
  const partner_last_read_at = partner
    ? (partner.member_last_read_at ?? 0)
    : chat.type === 'group'
      ? Math.max(0, ...rawMembers.filter(m => m.id !== userId).map(m => m.member_last_read_at ?? 0))
      : 0;

  return {
    ...chat,
    is_closed: chat.is_closed === 1,
    members,
    last_message: lastMsg ? decryptMessage(lastMsg) : null,
    unread_count: 0,
    partner_last_read_at,
  };
}

// ─── Chat queries ────────────────────────────────────────────────────────────

function getUserChats(userId) {
  const db = getDb();

  // 1. All chats for this user + their membership row
  const rows = db.prepare(`
    SELECT c.id, c.type, c.name, c.description, c.avatar_url, c.created_at,
           c.creator_id, c.is_closed,
           cm.is_pinned, cm.pin_order, cm.is_muted, cm.last_read_at AS my_last_read_at,
           cm.unread_count
    FROM chats c
    JOIN chat_members cm ON cm.chat_id = c.id
    WHERE cm.user_id = ?
    ORDER BY c.created_at DESC
  `).all(userId);

  if (!rows.length) return [];

  const chatIds = rows.map(r => r.id);
  const placeholders = chatIds.map(() => '?').join(',');

  // 2. All members of all chats in one query
  const allMembers = db.prepare(`
    SELECT cm.chat_id, cm.last_read_at AS member_last_read_at, cm.role,
           u.id, u.username, u.display_name, u.avatar_url, u.last_seen_at,
           u.hide_avatar, u.avatar_exceptions,
           u.presence_status, u.presence_note, u.presence_expires_at
    FROM chat_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.chat_id IN (${placeholders})
  `).all(chatIds);

  // 3. Latest message per chat in one query
  const lastMessages = db.prepare(`
    SELECT m.*
    FROM messages m
    INNER JOIN (
      SELECT chat_id, MAX(created_at) AS max_ts
      FROM messages
      WHERE chat_id IN (${placeholders}) AND deleted_at IS NULL
      GROUP BY chat_id
    ) latest ON m.chat_id = latest.chat_id AND m.created_at = latest.max_ts
    WHERE m.deleted_at IS NULL
  `).all(chatIds);

  // 4. (removed — unread_count now read directly from chat_members.unread_count)

  // 5. All contact aliases for this user in one query
  const allAliases = db.prepare(`
    SELECT target_id, alias FROM contact_aliases WHERE user_id = ?
  `).all(userId);

  // 6. All block relationships involving this user in one query
  const allBlocks = db.prepare(`
    SELECT blocker_id, blocked_id FROM blocked_users
    WHERE blocker_id = ? OR blocked_id = ?
  `).all([userId, userId]);

  // ── Build lookup maps ─────────────────────────────────────────────────────
  const membersByChat = {};
  for (const m of allMembers) {
    (membersByChat[m.chat_id] ??= []).push(m);
  }

  const lastMsgByChat = {};
  for (const m of lastMessages) lastMsgByChat[m.chat_id] = m;

  const aliasMap = {};
  for (const a of allAliases) aliasMap[a.target_id] = a.alias;

  const blockedByThem = new Set();
  for (const b of allBlocks) {
    if (b.blocked_id === userId) blockedByThem.add(b.blocker_id);
  }

  // ── Assemble result ───────────────────────────────────────────────────────
  return rows.map(chat => {
    const rawMembers = membersByChat[chat.id] || [];
    const members = rawMembers.map(u => {
      const alias = u.id !== userId ? (aliasMap[u.id] || null) : null;
      const sanitized = sanitizeUser(u, { viewerId: userId }, alias);
      if (u.id !== userId) {
        sanitized.blocked_by_them = blockedByThem.has(u.id);
      }
      sanitized.role = u.role || 'member';
      return sanitized;
    });

    const lastMsg = lastMsgByChat[chat.id] || null;

    const partner = chat.type === 'direct' ? rawMembers.find(m => m.id !== userId) : null;
    const partner_last_read_at = partner
      ? (partner.member_last_read_at ?? 0)
      : chat.type === 'group'
        ? Math.max(0, ...rawMembers.filter(m => m.id !== userId).map(m => m.member_last_read_at ?? 0))
        : 0;

    return {
      id:          chat.id,
      type:        chat.type,
      name:        chat.name,
      description: chat.description,
      avatar_url:  chat.avatar_url,
      created_at:  chat.created_at,
      creator_id:  chat.creator_id,
      is_closed:   chat.is_closed  === 1,
      is_pinned:   chat.is_pinned  === 1,
      pin_order:   chat.pin_order  ?? null,
      is_muted:    chat.is_muted   === 1,
      members,
      last_message: lastMsg ? decryptMessage(lastMsg) : null,
      unread_count: chat.unread_count || 0,
      partner_last_read_at,
    };
  });
}

// ── Pin a chat (toggle) ──────────────────────────────────────────────────────
function togglePinChat(chatId, userId) {
  const db = getDb();
  const member = db
    .prepare('SELECT is_pinned, pin_order FROM chat_members WHERE chat_id = ? AND user_id = ?')
    .get([chatId, userId]);
  if (!member) throw Object.assign(new Error('Not a member'), { status: 403 });

  if (member.is_pinned) {
    db.prepare('UPDATE chat_members SET is_pinned = 0, pin_order = NULL WHERE chat_id = ? AND user_id = ?')
      .run([chatId, userId]);
    // Re-number remaining pinned chats so orders stay 0-based and contiguous
    const remaining = db
      .prepare('SELECT chat_id FROM chat_members WHERE user_id = ? AND is_pinned = 1 ORDER BY pin_order ASC NULLS LAST')
      .all(userId);
    const upd = db.prepare('UPDATE chat_members SET pin_order = ? WHERE chat_id = ? AND user_id = ?');
    remaining.forEach(({ chat_id }, i) => upd.run([i, chat_id, userId]));
    return { is_pinned: false, pin_order: null };
  } else {
    const { cnt } = db
      .prepare('SELECT COUNT(*) as cnt FROM chat_members WHERE user_id = ? AND is_pinned = 1')
      .get(userId);
    if (cnt >= 5) throw Object.assign(new Error('Максимум 5 закреплённых чатов'), { status: 400 });

    const { maxOrder } = db
      .prepare('SELECT COALESCE(MAX(pin_order), -1) as maxOrder FROM chat_members WHERE user_id = ? AND is_pinned = 1')
      .get(userId);
    const newOrder = maxOrder + 1;
    db.prepare('UPDATE chat_members SET is_pinned = 1, pin_order = ? WHERE chat_id = ? AND user_id = ?')
      .run([newOrder, chatId, userId]);
    return { is_pinned: true, pin_order: newOrder };
  }
}

// ── Mute a chat (toggle) ─────────────────────────────────────────────────────
function toggleMuteChat(chatId, userId) {
  const db = getDb();
  const member = db
    .prepare('SELECT is_muted FROM chat_members WHERE chat_id = ? AND user_id = ?')
    .get([chatId, userId]);
  if (!member) throw Object.assign(new Error('Not a member'), { status: 403 });

  const newMuted = member.is_muted ? 0 : 1;
  db.prepare('UPDATE chat_members SET is_muted = ? WHERE chat_id = ? AND user_id = ?')
    .run([newMuted, chatId, userId]);
  return { is_muted: Boolean(newMuted) };
}

// ── Reorder pinned chats ──────────────────────────────────────────────────────
function updateChatPinOrder(userId, orderedChatIds) {
  const db = getDb();
  const upd = db.prepare(
    'UPDATE chat_members SET pin_order = ? WHERE chat_id = ? AND user_id = ? AND is_pinned = 1'
  );
  const run = db.transaction(() => {
    orderedChatIds.forEach((chatId, i) => upd.run([i, chatId, userId]));
  });
  run();
}

function createGroupChat(name, creatorId, memberIds, description) {
  const db = getDb();

  const validMemberIds = memberIds.filter(id => {
    const u = db.prepare('SELECT no_group_add FROM users WHERE id = ?').get(id);
    return !u?.no_group_add;
  });

  const allMembers = [...new Set([creatorId, ...validMemberIds])];
  if (allMembers.length < 2) {
    throw Object.assign(new Error('Добавьте хотя бы одного участника'), { status: 400 });
  }

  const chatId = uuidv4();
  const now = Date.now();
  const desc = description ? description.trim() : null;

  db.exec('BEGIN');
  try {
    db.prepare(
      'INSERT INTO chats (id, type, name, description, creator_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run([chatId, 'group', name.trim(), desc, creatorId, now]);

    for (const memberId of allMembers) {
      db.prepare(
        'INSERT INTO chat_members (chat_id, user_id, joined_at, role) VALUES (?, ?, ?, ?)'
      ).run([chatId, memberId, now, memberId === creatorId ? 'admin' : 'member']);
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return getChatById(chatId, creatorId);
}

function getOrCreateDirectChat(userAId, userBId) {
  const db = getDb();

  const existing = db
    .prepare(
      `SELECT c.id FROM chats c
       JOIN chat_members cm1 ON cm1.chat_id = c.id AND cm1.user_id = ?
       JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id = ?
       WHERE c.type = 'direct' LIMIT 1`
    )
    .get([userAId, userBId]);

  if (existing) return getChatById(existing.id, userAId);

  const chatId = uuidv4();
  const now = Date.now();

  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO chats (id, type, created_at) VALUES (?, ?, ?)').run([chatId, 'direct', now]);
    db.prepare('INSERT INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)').run([chatId, userAId, now]);
    db.prepare('INSERT INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)').run([chatId, userBId, now]);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return getChatById(chatId, userAId);
}

function getOrCreateSavedChat(userId) {
  const db = getDb();

  const existing = db
    .prepare(
      `SELECT c.id FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = ?
       WHERE c.type = 'saved' LIMIT 1`
    )
    .get([userId]);

  if (existing) return getChatById(existing.id, userId);

  const chatId = uuidv4();
  const now = Date.now();

  db.exec('BEGIN');
  try {
    db.prepare(
      'INSERT INTO chats (id, type, name, creator_id, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run([chatId, 'saved', 'Сохранённые сообщения', userId, now]);
    db.prepare(
      'INSERT INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)'
    ).run([chatId, userId, now]);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return getChatById(chatId, userId);
}

// ─── Membership ──────────────────────────────────────────────────────────────

function markChatAsRead(chatId, userId, readUntil) {
  const db = getDb();
  const ts = readUntil && readUntil < Date.now() ? readUntil : Date.now();
  // Move last_read_at forward only; always reset unread_count as self-correcting insurance against drift
  db.prepare('UPDATE chat_members SET last_read_at = ? WHERE chat_id = ? AND user_id = ? AND COALESCE(last_read_at, 0) < ?')
    .run([ts, chatId, userId, ts]);
  db.prepare('UPDATE chat_members SET unread_count = 0 WHERE chat_id = ? AND user_id = ?')
    .run([chatId, userId]);
  return ts;
}

function addChatMember(chatId, requesterId, newUserId) {
  const db = getDb();

  const chat = db.prepare('SELECT creator_id, type FROM chats WHERE id = ?').get(chatId);
  if (!chat || chat.type !== 'group') {
    throw Object.assign(new Error('Chat not found'), { status: 404 });
  }

  const requesterMember = db.prepare('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, requesterId]);
  if (!requesterMember || !['admin', 'moderator'].includes(requesterMember.role)) {
    throw Object.assign(new Error('Только администраторы и модераторы могут добавлять участников'), { status: 403 });
  }

  const existing = db
    .prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?')
    .get([chatId, newUserId]);
  if (existing) throw Object.assign(new Error('User already in chat'), { status: 409 });

  const targetUser = db.prepare('SELECT no_group_add FROM users WHERE id = ?').get(newUserId);
  if (targetUser?.no_group_add) {
    throw Object.assign(
      new Error('Этот пользователь запретил добавлять себя в группы'),
      { status: 403 }
    );
  }

  db.prepare('INSERT INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)').run([
    chatId, newUserId, Date.now(),
  ]);

  return getChatById(chatId, requesterId);
}

function removeChatMember(chatId, requesterId, targetUserId) {
  const db = getDb();

  if (!db.prepare('SELECT id FROM chats WHERE id = ?').get(chatId)) {
    throw Object.assign(new Error('Chat not found'), { status: 404 });
  }

  const requesterMember = db.prepare('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, requesterId]);
  if (!requesterMember) throw Object.assign(new Error('Not a member'), { status: 403 });

  // Allow self-removal (leave); otherwise check permissions
  if (requesterId !== targetUserId) {
    const targetMember = db.prepare('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, targetUserId]);
    if (!targetMember) throw Object.assign(new Error('Target not in chat'), { status: 404 });

    if (requesterMember.role === 'admin') {
      if (targetMember.role === 'admin') {
        throw Object.assign(new Error('Нельзя удалить другого администратора'), { status: 403 });
      }
    } else if (requesterMember.role === 'moderator') {
      if (targetMember.role !== 'member') {
        throw Object.assign(new Error('Модераторы могут удалять только обычных участников'), { status: 403 });
      }
    } else {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    }
  }

  const targetUser = db.prepare('SELECT display_name, username FROM users WHERE id = ?').get(targetUserId);
  const targetName = targetUser?.display_name || targetUser?.username || 'Пользователь';

  db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run([chatId, targetUserId]);

  const updatedChat = getChatById(chatId, requesterId);
  const remaining = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(chatId).map(r => r.user_id);

  const actorLabel = requesterMember.role === 'moderator' ? 'Модератор' : 'Администратор';
  const sysMsg = saveMessage(chatId, requesterId, `${actorLabel} удалил(а) ${targetName} из группы`, {}, true);

  return { updatedChat, sysMsg, remaining };
}

/**
 * leaveGroup — user voluntarily leaves a group.
 * ✅ If the user is the admin (creator), the group is CLOSED instead of leaving.
 *    Admin stays as member, group gets is_closed=1, system message is sent.
 */
function leaveGroup(chatId, userId) {
  const db = getDb();

  const chat = db.prepare('SELECT id, type, creator_id FROM chats WHERE id = ?').get(chatId);
  if (!chat || chat.type !== 'group') {
    throw Object.assign(new Error('Not a group'), { status: 400 });
  }

  const member = db
    .prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?')
    .get([chatId, userId]);
  if (!member) throw Object.assign(new Error('Not a member'), { status: 403 });

  // ✅ Admin leaving → close the group instead
  if (chat.creator_id === userId) {
    db.prepare('UPDATE chats SET is_closed = 1 WHERE id = ?').run(chatId);
    const sysMsg = saveMessage(chatId, userId, 'Администратор удалил(а) группу', {}, true);
    const allMembers = db
      .prepare('SELECT user_id FROM chat_members WHERE chat_id = ?')
      .all(chatId)
      .map(r => r.user_id);
    return { sysMsg, remaining: allMembers, closed: true };
  }

  // Regular member leaving
  const user = db.prepare('SELECT display_name, username FROM users WHERE id = ?').get(userId);
  const userName = user?.display_name || user?.username || 'Пользователь';

  db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run([chatId, userId]);

  const remaining = db
    .prepare('SELECT user_id FROM chat_members WHERE chat_id = ?')
    .all(chatId);

  let sysMsg = null;
  if (remaining.length > 0) {
    sysMsg = saveMessage(chatId, userId, `${userName} покинул(а) чат`, {}, true);
  }

  return { sysMsg, remaining: remaining.map(r => r.user_id), closed: false };
}

/**
 * closeGroup — admin explicitly closes a group from GroupInfoModal.
 * Sets is_closed=1, sends system message, admin stays in group.
 */
function closeGroup(chatId, requesterId) {
  const db = getDb();

  const chat = db.prepare('SELECT creator_id, type, is_closed FROM chats WHERE id = ?').get(chatId);
  if (!chat || chat.type !== 'group') {
    throw Object.assign(new Error('Not a group'), { status: 404 });
  }
  if (chat.creator_id !== requesterId) {
    throw Object.assign(new Error('Only the group admin can close the group'), { status: 403 });
  }
  if (chat.is_closed) {
    throw Object.assign(new Error('Group is already closed'), { status: 400 });
  }

  db.prepare('UPDATE chats SET is_closed = 1 WHERE id = ?').run(chatId);
  const sysMsg = saveMessage(chatId, requesterId, 'Администратор удалил(а) группу', {}, true);
  const allMembers = db
    .prepare('SELECT user_id FROM chat_members WHERE chat_id = ?')
    .all(chatId)
    .map(r => r.user_id);

  return { sysMsg, allMembers };
}

/**
 * transferAdmin — admin transfers creator rights to another member.
 * Updates creator_id, sends system message.
 */
function transferAdmin(chatId, requesterId, newAdminId) {
  const db = getDb();

  const chat = db.prepare('SELECT creator_id, type FROM chats WHERE id = ?').get(chatId);
  if (!chat || chat.type !== 'group') {
    throw Object.assign(new Error('Not a group'), { status: 404 });
  }
  if (chat.creator_id !== requesterId) {
    throw Object.assign(new Error('Only the group admin can transfer admin rights'), { status: 403 });
  }
  if (requesterId === newAdminId) {
    throw Object.assign(new Error('Cannot transfer to yourself'), { status: 400 });
  }

  const memberCheck = db
    .prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?')
    .get([chatId, newAdminId]);
  if (!memberCheck) {
    throw Object.assign(new Error('Target user is not a member of this group'), { status: 400 });
  }

  const newAdmin = db.prepare('SELECT display_name, username FROM users WHERE id = ?').get(newAdminId);
  const newAdminName = newAdmin?.display_name || newAdmin?.username || 'Пользователь';

  db.prepare('UPDATE chats SET creator_id = ? WHERE id = ?').run([newAdminId, chatId]);
  db.prepare('UPDATE chat_members SET role = ? WHERE chat_id = ? AND user_id = ?').run(['admin', chatId, newAdminId]);
  db.prepare('UPDATE chat_members SET role = ? WHERE chat_id = ? AND user_id = ?').run(['member', chatId, requesterId]);
  const sysMsg = saveMessage(chatId, requesterId, `Новый администратор группы — ${newAdminName}`, {}, true);

  const allMembers = db
    .prepare('SELECT user_id FROM chat_members WHERE chat_id = ?')
    .all(chatId)
    .map(r => r.user_id);

  // Return updated chat from the new admin's perspective
  const updatedChat = getChatById(chatId, newAdminId);
  return { sysMsg, allMembers, updatedChat };
}

function deleteDirectChat(chatId, userId) {
  const db = getDb();

  const chat = db.prepare('SELECT id, type FROM chats WHERE id = ?').get(chatId);
  if (!chat) throw Object.assign(new Error('Chat not found'), { status: 404 });

  const member = db
    .prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?')
    .get([chatId, userId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });

  if (chat.type !== 'direct') {
    throw Object.assign(new Error('Use leave for groups'), { status: 400 });
  }

  const members = db
    .prepare('SELECT user_id FROM chat_members WHERE chat_id = ?')
    .all(chatId);

  // Collect S3 objects before cascade delete
  const chatRow = db.prepare('SELECT avatar_url FROM chats WHERE id = ?').get(chatId);
  const attachments = db
    .prepare('SELECT attachment_url FROM messages WHERE chat_id = ? AND attachment_url IS NOT NULL')
    .all(chatId)
    .map(r => r.attachment_url);

  db.prepare('DELETE FROM chats WHERE id = ?').run([chatId]);

  // Fire-and-forget S3 cleanup
  deleteManyFromS3([chatRow?.avatar_url, ...attachments]);

  return members.map(m => m.user_id);
}

function updateChatMetadata(chatId, requesterId, { name, description, avatar_url }) {
  const db = getDb();

  const chat = db.prepare('SELECT creator_id, avatar_url FROM chats WHERE id = ?').get(chatId);
  if (!chat) throw Object.assign(new Error('Chat not found'), { status: 404 });
  if (chat.creator_id !== requesterId) {
    throw Object.assign(new Error('Only creator can update chat'), { status: 403 });
  }

  const oldAvatarUrl = avatar_url !== undefined ? (chat.avatar_url || null) : null;

  if (name !== undefined)
    db.prepare('UPDATE chats SET name = ? WHERE id = ?').run([name, chatId]);
  if (description !== undefined)
    db.prepare('UPDATE chats SET description = ? WHERE id = ?').run([description, chatId]);
  if (avatar_url !== undefined)
    db.prepare('UPDATE chats SET avatar_url = ? WHERE id = ?').run([avatar_url, chatId]);

  // Delete replaced avatar from S3 (fire-and-forget)
  if (oldAvatarUrl && oldAvatarUrl !== avatar_url) deleteFromS3(oldAvatarUrl);

  return getChatById(chatId, requesterId);
}

// ─── Account teardown ────────────────────────────────────────────────────────

function deleteAccount(userId) {
  const db = getDb();

  const user = db.prepare('SELECT display_name, username, avatar_url FROM users WHERE id = ?').get(userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  const userName = user.display_name || user.username || 'Пользователь';

  const groupChats = db
    .prepare(
      `SELECT c.id, c.creator_id FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id
       WHERE cm.user_id = ? AND c.type = 'group'`
    )
    .all(userId);

  const directChats = db
    .prepare(
      `SELECT c.id FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id
       WHERE cm.user_id = ? AND c.type = 'direct'`
    )
    .all(userId);

  // Collect S3 objects to delete after account teardown
  const s3UrlsToDelete = [user.avatar_url].filter(Boolean);
  if (directChats.length) {
    const placeholders = directChats.map(() => '?').join(',');
    const directChatIds = directChats.map(c => c.id);
    db.prepare(`SELECT attachment_url FROM messages WHERE chat_id IN (${placeholders}) AND attachment_url IS NOT NULL`)
      .all(directChatIds)
      .forEach(r => s3UrlsToDelete.push(r.attachment_url));
  }

  const groupNotifications = [];
  const deletedDirectChatIds = [];
  const directChatMembersMap = {};

  db.exec('BEGIN');
  try {
    for (const { id: chatId, creator_id } of groupChats) {
      const remaining = db
        .prepare('SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?')
        .all(chatId, userId)
        .map(r => r.user_id);

      if (remaining.length > 0) {
        // If user is admin, close the group
        const msgText = creator_id === userId
          ? 'Администратор удалил(а) группу'
          : `${userName} покинул(а) чат`;

        if (creator_id === userId) {
          db.prepare('UPDATE chats SET is_closed = 1 WHERE id = ?').run(chatId);
        }

        const sysMsg = saveMessage(chatId, userId, msgText, {}, true);
        groupNotifications.push({ chatId, sysMsg, remainingUserIds: remaining, closed: creator_id === userId });
      }

      db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(chatId, userId);
    }

    for (const { id: chatId } of directChats) {
      const members = db
        .prepare('SELECT user_id FROM chat_members WHERE chat_id = ?')
        .all(chatId)
        .map(r => r.user_id);
      directChatMembersMap[chatId] = members;
      deletedDirectChatIds.push(chatId);
      db.prepare('DELETE FROM chats WHERE id = ?').run(chatId);
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  // Fire-and-forget S3 cleanup (user avatar + all direct chat attachments)
  deleteManyFromS3(s3UrlsToDelete);

  return { groupNotifications, deletedDirectChatIds, directChatMembersMap };
}

// ── Roles ────────────────────────────────────────────────────────────────────

/**
 * setMemberRole — assign 'moderator' or 'member' to a chat member.
 * Only the group admin can call this.
 * Cannot change another admin's role; use transferAdmin to pass admin rights.
 */
function setMemberRole(chatId, requesterId, targetUserId, newRole) {
  const db = getDb();

  if (requesterId === targetUserId) {
    throw Object.assign(new Error('Нельзя изменить собственную роль'), { status: 400 });
  }

  const chat = db.prepare('SELECT type FROM chats WHERE id = ?').get(chatId);
  if (!chat || chat.type !== 'group') {
    throw Object.assign(new Error('Chat not found'), { status: 404 });
  }

  const requester = db.prepare('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, requesterId]);
  if (!requester || requester.role !== 'admin') {
    throw Object.assign(new Error('Только администраторы могут назначать роли'), { status: 403 });
  }

  const target = db.prepare('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, targetUserId]);
  if (!target) throw Object.assign(new Error('Пользователь не состоит в группе'), { status: 404 });
  if (target.role === 'admin') {
    throw Object.assign(new Error('Нельзя изменить роль администратора'), { status: 403 });
  }

  db.prepare('UPDATE chat_members SET role = ? WHERE chat_id = ? AND user_id = ?').run([newRole, chatId, targetUserId]);

  const targetUser = db.prepare('SELECT display_name, username FROM users WHERE id = ?').get(targetUserId);
  const targetName = targetUser?.display_name || targetUser?.username || 'Пользователь';
  const msgText = newRole === 'moderator'
    ? `${targetName} назначен(а) модератором`
    : `${targetName} больше не является модератором`;
  const sysMsg = saveMessage(chatId, requesterId, msgText, {}, true);

  const updatedChat = getChatById(chatId, requesterId);
  return { updatedChat, sysMsg };
}

module.exports = {
  getUserChats,
  getChatById,
  getOrCreateDirectChat,
  getOrCreateSavedChat,
  createGroupChat,
  markChatAsRead,
  addChatMember,
  removeChatMember,
  leaveGroup,
  closeGroup,
  transferAdmin,
  deleteDirectChat,
  updateChatMetadata,
  deleteAccount,
  togglePinChat,
  toggleMuteChat,
  updateChatPinOrder,
  setMemberRole,
};
