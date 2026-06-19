/**
 * services/chat/members.js — membership, roles, group lifecycle, group info.
 *   markChatAsRead, addChatMember, removeChatMember, leaveGroup, closeGroup,
 *   transferAdmin, updateChatMetadata, setMemberRole, setMemberPermissions
 */
const { getDb } = require('../../config/database');
const { deleteFromS3 } = require('../../utils/s3Delete');
const { saveMessage } = require('../messageService');
const { getMemberPermissions, sanitizePermissions } = require('../chatPermissions');
const { getChatById } = require('./queries');

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

  const requesterPerms = getMemberPermissions(db, chatId, requesterId);
  if (!requesterPerms || !requesterPerms.manage_members) {
    throw Object.assign(new Error('Недостаточно прав для добавления участников'), { status: 403 });
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

    // Capability gate: admin всегда, модератор — только с manage_members, member — нет
    const perms = getMemberPermissions(db, chatId, requesterId);
    if (!perms || !perms.manage_members) {
      throw Object.assign(new Error('Недостаточно прав для удаления участников'), { status: 403 });
    }
    // Ролевые ограничения на цель сохраняются
    if (requesterMember.role === 'admin') {
      if (targetMember.role === 'admin') {
        throw Object.assign(new Error('Нельзя удалить другого администратора'), { status: 403 });
      }
    } else if (targetMember.role !== 'member') {
      // модератор может удалять только обычных участников
      throw Object.assign(new Error('Модераторы могут удалять только обычных участников'), { status: 403 });
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

function updateChatMetadata(chatId, requesterId, { name, description, avatar_url }) {
  const db = getDb();

  const chat = db.prepare('SELECT creator_id, avatar_url FROM chats WHERE id = ?').get(chatId);
  if (!chat) throw Object.assign(new Error('Chat not found'), { status: 404 });
  // Редактировать инфо группы может создатель/админ ИЛИ модератор с правом edit_info
  const perms = getMemberPermissions(db, chatId, requesterId);
  if (!perms || !perms.edit_info) {
    throw Object.assign(new Error('Недостаточно прав для редактирования группы'), { status: 403 });
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

  // При понижении до участника сбрасываем гранулярные права; модератор стартует с дефолтными (NULL)
  db.prepare('UPDATE chat_members SET role = ?, permissions = NULL WHERE chat_id = ? AND user_id = ?')
    .run([newRole, chatId, targetUserId]);

  const targetUser = db.prepare('SELECT display_name, username FROM users WHERE id = ?').get(targetUserId);
  const targetName = targetUser?.display_name || targetUser?.username || 'Пользователь';
  const msgText = newRole === 'moderator'
    ? `${targetName} назначен(а) модератором`
    : `${targetName} больше не является модератором`;
  const sysMsg = saveMessage(chatId, requesterId, msgText, {}, true);

  const updatedChat = getChatById(chatId, requesterId);
  return { updatedChat, sysMsg };
}

/**
 * setMemberPermissions — админ настраивает гранулярные права модератора.
 * Только admin; цель должна быть модератором. Возвращает обновлённый чат.
 */
function setMemberPermissions(chatId, requesterId, targetUserId, permissions) {
  const db = getDb();

  const chat = db.prepare('SELECT type FROM chats WHERE id = ?').get(chatId);
  if (!chat || chat.type !== 'group') {
    throw Object.assign(new Error('Chat not found'), { status: 404 });
  }

  const requester = db.prepare('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, requesterId]);
  if (!requester || requester.role !== 'admin') {
    throw Object.assign(new Error('Только администраторы могут менять права'), { status: 403 });
  }

  const target = db.prepare('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, targetUserId]);
  if (!target) throw Object.assign(new Error('Пользователь не состоит в группе'), { status: 404 });
  if (target.role !== 'moderator') {
    throw Object.assign(new Error('Права настраиваются только для модераторов'), { status: 400 });
  }

  const clean = sanitizePermissions(permissions);
  db.prepare('UPDATE chat_members SET permissions = ? WHERE chat_id = ? AND user_id = ?')
    .run([JSON.stringify(clean), chatId, targetUserId]);

  return getChatById(chatId, requesterId);
}

module.exports = {
  markChatAsRead,
  addChatMember,
  removeChatMember,
  leaveGroup,
  closeGroup,
  transferAdmin,
  updateChatMetadata,
  setMemberRole,
  setMemberPermissions,
};
