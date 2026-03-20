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
 *   - leaveGroup            — user voluntarily leaves a group
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
      'SELECT id, type, name, description, avatar_url, created_at, creator_id FROM chats WHERE id = ?'
    )
    .get(chatId);
  if (!chat) return null;

  const member = db
    .prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?')
    .get([chatId, userId]);
  if (!member) return null;

  const members = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.last_seen_at
       FROM chat_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.chat_id = ?`
    )
    .all(chatId)
    .map(u => sanitizeUser(u));

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
      `SELECT c.id, c.type, c.name, c.description, c.avatar_url, c.created_at, c.creator_id
       FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id
       WHERE cm.user_id = ?
       ORDER BY c.created_at DESC`
    )
    .all(userId);

  return chats.map(chat => {
    const members = db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.avatar_url, u.last_seen_at
         FROM chat_members cm JOIN users u ON u.id = cm.user_id
         WHERE cm.chat_id = ?`
      )
      .all(chat.id)
      .map(u => sanitizeUser(u));

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

function leaveGroup(chatId, userId) {
  const db = getDb();

  const chat = db.prepare('SELECT id, type FROM chats WHERE id = ?').get(chatId);
  if (!chat || chat.type !== 'group') {
    throw Object.assign(new Error('Not a group'), { status: 400 });
  }

  const member = db
    .prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?')
    .get([chatId, userId]);
  if (!member) throw Object.assign(new Error('Not a member'), { status: 403 });

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

  return { sysMsg, remaining: remaining.map(r => r.user_id) };
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
      `SELECT c.id FROM chats c
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
    for (const { id: chatId } of groupChats) {
      const remaining = db
        .prepare('SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?')
        .all(chatId, userId)
        .map(r => r.user_id);

      if (remaining.length > 0) {
        const sysMsg = saveMessage(chatId, userId, `${userName} покинул(а) чат`, {}, true);
        groupNotifications.push({ chatId, sysMsg, remainingUserIds: remaining });
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
  deleteDirectChat,
  updateChatMetadata,
  deleteAccount,
};
