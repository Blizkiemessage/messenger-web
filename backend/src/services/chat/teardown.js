/**
 * services/chat/teardown.js — destructive operations.
 *   deleteDirectChat — delete a 1-to-1 chat for both users
 *   deleteAccount    — full account teardown with group/direct notifications
 */
const { getDb } = require('../../config/database');
const { deleteManyFromS3 } = require('../../utils/s3Delete');
const { saveMessage } = require('../messageService');
const { DELETED_ACCOUNT_USER_ID } = require('../userService');
const { systemEventAttachment } = require('../../utils/systemEvents');

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

        const eventKind = creator_id === userId ? 'group_closed' : 'member_left';
        const eventParams = creator_id === userId ? {} : { userName };
        const sysMsg = saveMessage(chatId, userId, msgText, systemEventAttachment(eventKind, eventParams), true);
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

    // `messages.sender_id`, `calls.caller_id`/`callee_id` and
    // `chat_notes.last_edited_by`/`created_by` reference users(id) WITHOUT a
    // cascade/set-null action (001_initial.js) — with PRAGMA foreign_keys=ON
    // (always on, config/database.js) any surviving row referencing this user
    // blocks the DELETE below with "FOREIGN KEY constraint failed": a message
    // in a GROUP chat they've left (chat survives for the remaining members,
    // only chat_members is removed above), a call, or a chat note. Discovered
    // 2026-07-03 testing a real production account that had made a WebRTC call.
    //
    // Content must NOT be deleted to route around this — messages/calls/notes
    // belong to the conversation, not solely to the departing user — so every
    // orphaned reference is reassigned to a single permanent, login-less
    // "Удалённый аккаунт" placeholder instead (DELETED_ACCOUNT_USER_ID,
    // seeded by db/versions/017_deleted_account_ghost.js). Whatever the ghost
    // account accumulates this way is subject to its own long-term retention
    // cleanup (workers/deletedAccountCleanup.js), so this doesn't grow the
    // database forever.
    db.prepare('UPDATE messages SET sender_id = ? WHERE sender_id = ?').run(DELETED_ACCOUNT_USER_ID, userId);
    db.prepare('UPDATE calls SET caller_id = ? WHERE caller_id = ?').run(DELETED_ACCOUNT_USER_ID, userId);
    db.prepare('UPDATE calls SET callee_id = ? WHERE callee_id = ?').run(DELETED_ACCOUNT_USER_ID, userId);
    db.prepare('UPDATE chat_notes SET last_edited_by = ? WHERE last_edited_by = ?').run(DELETED_ACCOUNT_USER_ID, userId);
    db.prepare('UPDATE chat_notes SET created_by = ? WHERE created_by = ?').run(DELETED_ACCOUNT_USER_ID, userId);

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

module.exports = { deleteDirectChat, deleteAccount };
