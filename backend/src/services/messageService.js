/**
 * messageService.js — All message-related DB operations.
 * ✅ Added: pinMessage, unpinMessage, getPinnedMessages
 */
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { encrypt, decrypt } = require('../crypto/aes');
const { deleteFromS3 } = require('../utils/s3Delete');

function decryptMessage(msg) {
  let text = '';
  try {
    text = decrypt({ ciphertext: msg.ciphertext, iv: msg.iv, authTag: msg.auth_tag }).trim();
  } catch { text = '[encrypted]'; }

  // Decrypt reply snippet if present
  let reply = null;
  if (msg.reply_to_id) {
    let replyText = null;
    if (msg.reply_to_ciphertext) {
      try {
        replyText = decrypt({
          ciphertext: msg.reply_to_ciphertext,
          iv: msg.reply_to_iv,
          authTag: msg.reply_to_auth_tag,
        }).trim();
      } catch { replyText = null; }
    }
    reply = {
      id: msg.reply_to_id,
      sender_id: msg.reply_to_sender_id || null,
      sender_username: msg.reply_to_sender_username || null,
      text: replyText,
    };
  }

  return {
    id: msg.id, chat_id: msg.chat_id, sender_id: msg.sender_id, text,
    created_at: msg.created_at, deleted_at: msg.deleted_at || null,
    attachment_url: msg.attachment_url || null, attachment_type: msg.attachment_type || null,
    attachment_name: msg.attachment_name || null, attachment_meta: msg.attachment_meta || null,
    attachment_size: msg.attachment_size || null,
    attachment_duration: msg.attachment_duration != null ? msg.attachment_duration : null,
    liked_by: JSON.parse(msg.liked_by || '[]'),
    reactions: JSON.parse(msg.reactions || '[]'),
    is_system: msg.is_system ? true : false,
    is_pinned: msg.is_pinned ? true : false,
    forwarded_from_user_id: msg.forwarded_from_user_id || null,
    forwarded_from_username: msg.forwarded_from_username || null,
    poll_id: msg.poll_id || null,
    reply,
    edited_at: msg.edited_at || null,
  };
}

function getChatMessages(chatId, userId, { limit = 50, before = null } = {}) {
  const db = getDb();
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, userId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });
  const rows = before
    ? db.prepare(`SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL AND created_at < ? AND id NOT IN (SELECT message_id FROM message_hidden WHERE user_id = ?) ORDER BY created_at DESC LIMIT ?`).all([chatId, before, userId, limit])
    : db.prepare(`SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL AND id NOT IN (SELECT message_id FROM message_hidden WHERE user_id = ?) ORDER BY created_at DESC LIMIT ?`).all([chatId, userId, limit]);
  const messages = rows.reverse().map(decryptMessage);

  // Attach poll payloads for poll messages
  const pollIds = messages.filter(m => m.poll_id).map(m => m.poll_id);
  if (pollIds.length > 0) {
    const { buildPollPayload } = require('./pollService');
    const placeholders = pollIds.map(() => '?').join(',');
    const polls = db.prepare(`SELECT * FROM polls WHERE id IN (${placeholders})`).all(pollIds);
    const pollMap = {};
    for (const p of polls) pollMap[p.id] = buildPollPayload(p, userId);
    for (const m of messages) {
      if (m.poll_id && pollMap[m.poll_id]) m.poll = pollMap[m.poll_id];
    }
  }

  return messages;
}

function saveMessage(chatId, senderId, text, attachment = {}, isSystem = false, reply = null, pollId = null) {
  const db = getDb();
  if (!isSystem) {
    const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, senderId]);
    if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });
  }
  const { ciphertext, iv, authTag } = encrypt(text || '');
  const msgId = uuidv4();
  const now = Date.now();

  // Encrypt reply snippet if provided
  let replyToId = null, replyToSenderId = null, replyToSenderUsername = null;
  let replyToCiphertext = null, replyToIv = null, replyToAuthTag = null;
  if (reply && reply.id) {
    replyToId = reply.id;
    replyToSenderId = reply.sender_id || null;
    replyToSenderUsername = reply.sender_username || null;
    const snippet = (reply.quoted_text || '').slice(0, 200);
    if (snippet) {
      const enc = encrypt(snippet);
      replyToCiphertext = enc.ciphertext;
      replyToIv = enc.iv;
      replyToAuthTag = enc.authTag;
    }
  }

  db.prepare(
    `INSERT INTO messages (id, chat_id, sender_id, ciphertext, iv, auth_tag, created_at,
       attachment_url, attachment_type, attachment_name, attachment_meta, attachment_size, attachment_duration, is_system,
       reply_to_id, reply_to_sender_id, reply_to_sender_username,
       reply_to_ciphertext, reply_to_iv, reply_to_auth_tag, poll_id, search_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run([msgId, chatId, senderId, ciphertext, iv, authTag, now,
    attachment.attachment_url || null, attachment.attachment_type || null,
    attachment.attachment_name || null, attachment.attachment_meta || null,
    attachment.attachment_size || null,
    attachment.attachment_duration != null ? attachment.attachment_duration : null,
    isSystem ? 1 : 0,
    replyToId, replyToSenderId, replyToSenderUsername,
    replyToCiphertext, replyToIv, replyToAuthTag,
    pollId || null,
    isSystem ? null : (text || null)]);

  // Increment unread_count for all chat members except the sender
  db.prepare(`
    UPDATE chat_members SET unread_count = unread_count + 1
    WHERE chat_id = ? AND user_id != ?
  `).run([chatId, senderId]);

  return decryptMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId));
}

function deleteMessages(chatId, userId, messageIds) {
  const db = getDb();
  const member = db.prepare('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, userId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });

  const chat = db.prepare('SELECT type FROM chats WHERE id = ?').get(chatId);
  const isPrivileged = chat?.type === 'group' && (member.role === 'admin' || member.role === 'moderator');

  const now = Date.now();
  const deleted = [];
  for (const msgId of messageIds) {
    const msg = db.prepare('SELECT id, sender_id, attachment_url FROM messages WHERE id = ? AND chat_id = ? AND deleted_at IS NULL').get([msgId, chatId]);
    if (!msg) continue;
    // Only allow: author of the message, or admin/moderator in a group chat
    if (msg.sender_id !== userId && !isPrivileged) continue;
    db.prepare('UPDATE messages SET deleted_at = ? WHERE id = ?').run([now, msgId]);
    deleted.push(msgId);
    if (msg.attachment_url) deleteFromS3(msg.attachment_url); // fire-and-forget
  }
  return deleted;
}

function hideMessages(userId, chatId, messageIds) {
  const db = getDb();
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, userId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });
  const hidden = [];
  for (const msgId of messageIds) {
    const msg = db.prepare('SELECT id FROM messages WHERE id = ? AND chat_id = ? AND deleted_at IS NULL').get([msgId, chatId]);
    if (!msg) continue;
    db.prepare('INSERT OR IGNORE INTO message_hidden (user_id, message_id) VALUES (?, ?)').run([userId, msgId]);
    hidden.push(msgId);
  }
  return hidden;
}

function toggleReaction(msgId, userId) {
  const db = getDb();
  const msg = db.prepare('SELECT liked_by FROM messages WHERE id = ?').get(msgId);
  if (!msg) throw Object.assign(new Error('Message not found'), { status: 404 });
  let liked = JSON.parse(msg.liked_by || '[]');
  liked = liked.includes(userId) ? liked.filter(id => id !== userId) : [...liked, userId];
  db.prepare('UPDATE messages SET liked_by = ? WHERE id = ?').run([JSON.stringify(liked), msgId]);
  return liked;
}

// ✅ NEW: pin a message (admin/moderator only)
function pinMessage(chatId, messageId, requesterId) {
  const db = getDb();
  const member = db.prepare('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, requesterId]);
  if (!member || !['admin', 'moderator'].includes(member.role || 'member')) {
    throw Object.assign(new Error('Только администраторы и модераторы могут закреплять сообщения'), { status: 403 });
  }
  const msg = db.prepare('SELECT id, chat_id FROM messages WHERE id = ? AND chat_id = ? AND deleted_at IS NULL').get([messageId, chatId]);
  if (!msg) throw Object.assign(new Error('Message not found'), { status: 404 });
  db.prepare('UPDATE messages SET is_pinned = 1 WHERE id = ?').run(messageId);
  return decryptMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId));
}

// ✅ NEW: unpin a message (admin/moderator only)
function unpinMessage(chatId, messageId, requesterId) {
  const db = getDb();
  const member = db.prepare('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, requesterId]);
  if (!member || !['admin', 'moderator'].includes(member.role || 'member')) {
    throw Object.assign(new Error('Только администраторы и модераторы могут откреплять сообщения'), { status: 403 });
  }
  db.prepare('UPDATE messages SET is_pinned = 0 WHERE id = ? AND chat_id = ?').run([messageId, chatId]);
  return { ok: true, messageId };
}

// ✅ NEW: get all pinned messages for a chat
function getPinnedMessages(chatId, userId) {
  const db = getDb();
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, userId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });
  const rows = db.prepare('SELECT * FROM messages WHERE chat_id = ? AND is_pinned = 1 AND deleted_at IS NULL ORDER BY created_at ASC').all(chatId);
  return rows.map(decryptMessage);
}

// ✅ NEW: forward messages to a chat
function forwardMessages(targetChatId, senderId, messageIds) {
  const db = getDb();
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([targetChatId, senderId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });

  const results = [];
  for (const msgId of messageIds) {
    const orig = db.prepare('SELECT * FROM messages WHERE id = ? AND deleted_at IS NULL').get(msgId);
    if (!orig) continue;

    // Get original sender info for attribution
    const origSender = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(orig.sender_id);
    const senderLabel = origSender?.username
      ? `@${origSender.username}`
      : (origSender?.display_name || 'Пользователь');

    // If the original was itself forwarded, preserve the original attribution chain
    const fwdUserId   = orig.forwarded_from_user_id || orig.sender_id;
    const fwdUsername = orig.forwarded_from_username || senderLabel;

    // Decrypt and re-encrypt into the new chat
    const origDecrypted = decryptMessage(orig);
    const { ciphertext, iv, authTag } = encrypt(origDecrypted.text || '');
    const newId = uuidv4();
    const now   = Date.now();

    db.prepare(
      `INSERT INTO messages
         (id, chat_id, sender_id, ciphertext, iv, auth_tag, created_at,
          attachment_url, attachment_type, attachment_name, attachment_size,
          is_system, forwarded_from_user_id, forwarded_from_username, search_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    ).run([
      newId, targetChatId, senderId, ciphertext, iv, authTag, now,
      orig.attachment_url || null, orig.attachment_type || null,
      orig.attachment_name || null, orig.attachment_size || null,
      fwdUserId, fwdUsername,
      origDecrypted.text || null,
    ]);

    // Increment unread_count for all members except the forwarder
    db.prepare(`
      UPDATE chat_members SET unread_count = unread_count + 1
      WHERE chat_id = ? AND user_id != ?
    `).run([targetChatId, senderId]);

    results.push(decryptMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(newId)));
  }
  return results;
}

const ALLOWED_EMOJIS = new Set(['❤️','👍','😂','😮','😢','🔥','👏','🎉','🤔','💯','😍','😡']);
// Custom emoji format: :packId:itemId: (two UUIDs separated by colon)
const CUSTOM_EMOJI_RE = /^:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:$/;

// ✅ NEW: emoji reactions — toggle a specific emoji reaction for a user.
// One reaction per user per message: adding a new emoji removes the previous one.
function toggleEmojiReaction(msgId, userId, emoji) {
  if (!ALLOWED_EMOJIS.has(emoji) && !CUSTOM_EMOJI_RE.test(emoji)) {
    throw Object.assign(new Error('Invalid emoji'), { status: 400 });
  }
  const db = getDb();
  const msg = db.prepare('SELECT reactions FROM messages WHERE id = ?').get(msgId);
  if (!msg) throw Object.assign(new Error('Message not found'), { status: 404 });
  let reactions = JSON.parse(msg.reactions || '[]');

  const sameEmojiIdx = reactions.findIndex(r => r.userId === userId && r.emoji === emoji);
  if (sameEmojiIdx >= 0) {
    // User clicked same emoji → remove (toggle off)
    reactions.splice(sameEmojiIdx, 1);
  } else {
    // Remove any existing reaction this user already has (enforce 1 per user)
    reactions = reactions.filter(r => r.userId !== userId);
    // Cap total reactions per message at 200
    if (reactions.length < 200) reactions.push({ userId, emoji });
  }
  db.prepare('UPDATE messages SET reactions = ? WHERE id = ?').run([JSON.stringify(reactions), msgId]);
  return reactions;
}

function editMessage(chatId, msgId, senderId, newText) {
  const db = getDb();
  const msg = db.prepare('SELECT id, sender_id, chat_id, attachment_url FROM messages WHERE id = ? AND chat_id = ? AND deleted_at IS NULL').get([msgId, chatId]);
  if (!msg) throw Object.assign(new Error('Message not found'), { status: 404 });
  if (msg.sender_id !== senderId) throw Object.assign(new Error('Forbidden'), { status: 403 });
  if (msg.attachment_url) throw Object.assign(new Error('Cannot edit attachment messages'), { status: 400 });
  const { ciphertext, iv, authTag } = encrypt(newText.trim());
  const now = Date.now();
  db.prepare('UPDATE messages SET ciphertext = ?, iv = ?, auth_tag = ?, edited_at = ? WHERE id = ?')
    .run([ciphertext, iv, authTag, now, msgId]);
  return decryptMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId));
}

module.exports = { decryptMessage, saveMessage, getChatMessages, deleteMessages, hideMessages, toggleReaction, toggleEmojiReaction, pinMessage, unpinMessage, getPinnedMessages, forwardMessages, editMessage };
