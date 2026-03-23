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
<<<<<<< HEAD
 *   - leaveGroup            — user voluntarily leaves a group
=======
 *   - leaveGroup            — user voluntarily leaves a group (admin → closes group)
 *   - closeGroup            — admin explicitly closes group (from GroupInfoModal)
 *   - transferAdmin         — transfer admin rights to another member
>>>>>>> devDK
 *   - deleteDirectChat      — delete a direct chat for both users
 *   - updateChatMetadata    — rename / re-describe a group (creator only)
 *   - deleteAccount         — full account teardown with notifications
 *
 * Depends on: userService (sanitizeUser), messageService (decryptMessage, saveMessage)
 */

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { sanitizeUser } = require('./userService');
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
<<<<<<< HEAD
      'SELECT id, type, name, description, avatar_url, created_at, creator_id FROM chats WHERE id = ?'
=======
      'SELECT id, type, name, description, avatar_url, created_at, creator_id, is_closed FROM chats WHERE id = ?'
>>>>>>> devDK
    )
    .get(chatId);
  if (!chat) return null;

  const member = db
    .prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?')
    .get([chatId, userId]);
  if (!member) return null;

  const members = db
    .prepare(
<<<<<<< HEAD
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.last_seen_at
=======
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.last_seen_at, u.hide_avatar, u.avatar_exceptions
>>>>>>> devDK
       FROM chat_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.chat_id = ?`
    )
    .all(chatId)
<<<<<<< HEAD
    .map(u => sanitizeUser(u));
=======
    .map(u => sanitizeUser(u, { viewerId: userId }));
>>>>>>> devDK

  const lastMsg = db
    .prepare(
      'SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1'
    )
    .get(chatId);

  const partner = chat.type === 'direct' ? members.find(m => m.id !== userId) : null;
  const partner_last_read_at = partner
    ? db
        .prepare('SELECT last_read_at FROM chat_members WHERE chat_id = ? AND user_id = ?')
        .get([chatId, partner.id])?.last_read_at ?? 0
    : chat.type === 'group'
      ? db
          .prepare(
            'SELECT MAX(last_read_at) as maxr FROM chat_members WHERE chat_id = ? AND user_id != ?'
          )
          .get([chatId, userId])?.maxr ?? 0
      : 0;

  return {
    ...chat,
<<<<<<< HEAD
=======
    is_closed: chat.is_closed === 1,
>>>>>>> devDK
    members,
    last_message: lastMsg ? decryptMessage(lastMsg) : null,
    unread_count: 0,
    partner_last_read_at,
  };
}

// ─── Chat queries ────────────────────────────────────────────────────────────

function getUserChats(userId) {
  const db = getDb();

  const chats = db
    .prepare(
<<<<<<< HEAD
      `SELECT c.id, c.type, c.name, c.description, c.avatar_url, c.created_at, c.creator_id
=======
      `SELECT c.id, c.type, c.name, c.description, c.avatar_url, c.created_at, c.creator_id, c.is_closed
>>>>>>> devDK
       FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id
       WHERE cm.user_id = ?
       ORDER BY c.created_at DESC`
    )
    .all(userId);

  return chats.map(chat => {
    const members = db
      .prepare(
<<<<<<< HEAD
        `SELECT u.id, u.username, u.display_name, u.avatar_url, u.last_seen_at
=======
        `SELECT u.id, u.username, u.display_name, u.avatar_url, u.last_seen_at, u.hide_avatar, u.avatar_exceptions
>>>>>>> devDK
         FROM chat_members cm JOIN users u ON u.id = cm.user_id
         WHERE cm.chat_id = ?`
      )
      .all(chat.id)
<<<<<<< HEAD
      .map(u => sanitizeUser(u));
=======
      .map(u => sanitizeUser(u, { viewerId: userId }));
>>>>>>> devDK

    const lastMsg = db
      .prepare(
        `SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(chat.id);

    const myMember = db
      .prepare('SELECT last_read_at FROM chat_members WHERE chat_id = ? AND user_id = ?')
      .get([chat.id, userId]);

    const unread_count = lastMsg
      ? db
          .prepare(
            `SELECT COUNT(*) as cnt FROM messages
             WHERE chat_id = ? AND created_at > ? AND deleted_at IS NULL AND sender_id != ?`
          )
          .get([chat.id, myMember?.last_read_at ?? 0, userId])?.cnt ?? 0
      : 0;

    const partner = chat.type === 'direct' ? members.find(m => m.id !== userId) : null;
    const partner_last_read_at = partner
      ? db
          .prepare('SELECT last_read_at FROM chat_members WHERE chat_id = ? AND user_id = ?')
          .get([chat.id, partner.id])?.last_read_at ?? 0
      : chat.type === 'group'
        ? db
            .prepare(
              'SELECT MAX(last_read_at) as maxr FROM chat_members WHERE chat_id = ? AND user_id != ?'
            )
            .get([chat.id, userId])?.maxr ?? 0
        : 0;

    return {
      ...chat,
<<<<<<< HEAD
=======
      is_closed: chat.is_closed === 1,
>>>>>>> devDK
      members,
      last_message: lastMsg ? decryptMessage(lastMsg) : null,
      unread_count: unread_count || 0,
      partner_last_read_at,
    };
  });
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
        'INSERT INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)'
      ).run([chatId, memberId, now]);
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

// ─── Membership ──────────────────────────────────────────────────────────────

function markChatAsRead(chatId, userId) {
  const now = Date.now();
  getDb()
    .prepare('UPDATE chat_members SET last_read_at = ? WHERE chat_id = ? AND user_id = ?')
    .run([now, chatId, userId]);
  return now;
}

function addChatMember(chatId, requesterId, newUserId) {
  const db = getDb();

  const chat = db.prepare('SELECT creator_id, type FROM chats WHERE id = ?').get(chatId);
  if (!chat || chat.type !== 'group') {
    throw Object.assign(new Error('Chat not found'), { status: 404 });
  }
  if (chat.creator_id !== requesterId) {
    throw Object.assign(new Error('Only the group creator can add members'), { status: 403 });
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

  const chat = db.prepare('SELECT creator_id FROM chats WHERE id = ?').get(chatId);
  if (!chat) throw Object.assign(new Error('Chat not found'), { status: 404 });
  if (chat.creator_id !== requesterId && requesterId !== targetUserId) {
    throw Object.assign(new Error('Only creator can remove members'), { status: 403 });
  }

  const targetUser = db
    .prepare('SELECT display_name, username FROM users WHERE id = ?')
    .get(targetUserId);
  const targetName = targetUser?.display_name || targetUser?.username || 'Пользователь';

  db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run([chatId, targetUserId]);

  const updatedChat = getChatById(chatId, requesterId);
  const remaining = db
    .prepare('SELECT user_id FROM chat_members WHERE chat_id = ?')
    .all(chatId)
    .map(r => r.user_id);

  const sysMsg = saveMessage(chatId, requesterId, `Администратор удалил(а) ${targetName} из группы`, {}, true);

  return { updatedChat, sysMsg, remaining };
}

<<<<<<< HEAD
function leaveGroup(chatId, userId) {
  const db = getDb();

  const chat = db.prepare('SELECT id, type FROM chats WHERE id = ?').get(chatId);
=======
/**
 * leaveGroup — user voluntarily leaves a group.
 * ✅ If the user is the admin (creator), the group is CLOSED instead of leaving.
 *    Admin stays as member, group gets is_closed=1, system message is sent.
 */
function leaveGroup(chatId, userId) {
  const db = getDb();

  const chat = db.prepare('SELECT id, type, creator_id FROM chats WHERE id = ?').get(chatId);
>>>>>>> devDK
  if (!chat || chat.type !== 'group') {
    throw Object.assign(new Error('Not a group'), { status: 400 });
  }

  const member = db
    .prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?')
    .get([chatId, userId]);
  if (!member) throw Object.assign(new Error('Not a member'), { status: 403 });

<<<<<<< HEAD
=======
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
>>>>>>> devDK
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

<<<<<<< HEAD
  return { sysMsg, remaining: remaining.map(r => r.user_id) };
=======
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
  const sysMsg = saveMessage(chatId, requesterId, `Новый администратор группы — ${newAdminName}`, {}, true);

  const allMembers = db
    .prepare('SELECT user_id FROM chat_members WHERE chat_id = ?')
    .all(chatId)
    .map(r => r.user_id);

  // Return updated chat from the new admin's perspective
  const updatedChat = getChatById(chatId, newAdminId);
  return { sysMsg, allMembers, updatedChat };
>>>>>>> devDK
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

  db.prepare('DELETE FROM chats WHERE id = ?').run([chatId]);

  return members.map(m => m.user_id);
}

function updateChatMetadata(chatId, requesterId, { name, description, avatar_url }) {
  const db = getDb();

  const chat = db.prepare('SELECT creator_id FROM chats WHERE id = ?').get(chatId);
  if (!chat) throw Object.assign(new Error('Chat not found'), { status: 404 });
  if (chat.creator_id !== requesterId) {
    throw Object.assign(new Error('Only creator can update chat'), { status: 403 });
  }

  if (name !== undefined)
    db.prepare('UPDATE chats SET name = ? WHERE id = ?').run([name, chatId]);
  if (description !== undefined)
    db.prepare('UPDATE chats SET description = ? WHERE id = ?').run([description, chatId]);
  if (avatar_url !== undefined)
    db.prepare('UPDATE chats SET avatar_url = ? WHERE id = ?').run([avatar_url, chatId]);

  return getChatById(chatId, requesterId);
}

// ─── Account teardown ────────────────────────────────────────────────────────

function deleteAccount(userId) {
  const db = getDb();

  const user = db.prepare('SELECT display_name, username FROM users WHERE id = ?').get(userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  const userName = user.display_name || user.username || 'Пользователь';

  const groupChats = db
    .prepare(
<<<<<<< HEAD
      `SELECT c.id FROM chats c
=======
      `SELECT c.id, c.creator_id FROM chats c
>>>>>>> devDK
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

  const groupNotifications = [];
  const deletedDirectChatIds = [];
  const directChatMembersMap = {};

  db.exec('BEGIN');
  try {
<<<<<<< HEAD
    for (const { id: chatId } of groupChats) {
=======
    for (const { id: chatId, creator_id } of groupChats) {
>>>>>>> devDK
      const remaining = db
        .prepare('SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?')
        .all(chatId, userId)
        .map(r => r.user_id);

      if (remaining.length > 0) {
<<<<<<< HEAD
        const sysMsg = saveMessage(chatId, userId, `${userName} покинул(а) чат`, {}, true);
        groupNotifications.push({ chatId, sysMsg, remainingUserIds: remaining });
=======
        // If user is admin, close the group
        const msgText = creator_id === userId
          ? 'Администратор удалил(а) группу'
          : `${userName} покинул(а) чат`;

        if (creator_id === userId) {
          db.prepare('UPDATE chats SET is_closed = 1 WHERE id = ?').run(chatId);
        }

        const sysMsg = saveMessage(chatId, userId, msgText, {}, true);
        groupNotifications.push({ chatId, sysMsg, remainingUserIds: remaining, closed: creator_id === userId });
>>>>>>> devDK
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

  return { groupNotifications, deletedDirectChatIds, directChatMembersMap };
}

module.exports = {
  getUserChats,
  getChatById,
  getOrCreateDirectChat,
  createGroupChat,
  markChatAsRead,
  addChatMember,
  removeChatMember,
  leaveGroup,
<<<<<<< HEAD
=======
  closeGroup,
  transferAdmin,
>>>>>>> devDK
  deleteDirectChat,
  updateChatMetadata,
  deleteAccount,
};
