/**
 * messageService.js — All message-related DB operations.
 * ✅ Added: pinMessage, unpinMessage, getPinnedMessages
 */
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { encrypt, decrypt } = require('../crypto/aes');

function decryptMessage(msg) {
  let text = '';
  try {
    text = decrypt({ ciphertext: msg.ciphertext, iv: msg.iv, authTag: msg.auth_tag }).trim();
  } catch { text = '[encrypted]'; }
  return {
    id: msg.id, chat_id: msg.chat_id, sender_id: msg.sender_id, text,
    created_at: msg.created_at, deleted_at: msg.deleted_at || null,
    attachment_url: msg.attachment_url || null, attachment_type: msg.attachment_type || null,
    attachment_name: msg.attachment_name || null, attachment_size: msg.attachment_size || null,
    liked_by: JSON.parse(msg.liked_by || '[]'),
    is_system: msg.is_system ? true : false,
    is_pinned: msg.is_pinned ? true : false,
    forwarded_from_user_id: msg.forwarded_from_user_id || null,
    forwarded_from_username: msg.forwarded_from_username || null,
  };
}

function getChatMessages(chatId, userId, { limit = 50, before = null } = {}) {
  const db = getDb();
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, userId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });
  const rows = before
    ? db.prepare(`SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL AND created_at < ? ORDER BY created_at DESC LIMIT ?`).all([chatId, before, limit])
    : db.prepare(`SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`).all([chatId, limit]);
  return rows.reverse().map(decryptMessage);
}

function saveMessage(chatId, senderId, text, attachment = {}, isSystem = false) {
  const db = getDb();
  if (!isSystem) {
    const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, senderId]);
    if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });
  }
  const { ciphertext, iv, authTag } = encrypt(text || '');
  const msgId = uuidv4();
  const now = Date.now();
  db.prepare(
    `INSERT INTO messages (id, chat_id, sender_id, ciphertext, iv, auth_tag, created_at, attachment_url, attachment_type, attachment_name, attachment_size, is_system)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run([msgId, chatId, senderId, ciphertext, iv, authTag, now,
    attachment.attachment_url || null, attachment.attachment_type || null,
    attachment.attachment_name || null, attachment.attachment_size || null,
    isSystem ? 1 : 0]);
  return decryptMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId));
}

function deleteMessages(chatId, senderId, messageIds) {
  const db = getDb();
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, senderId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });
  const now = Date.now();
  const deleted = [];
  for (const msgId of messageIds) {
    const msg = db.prepare('SELECT id, sender_id FROM messages WHERE id = ? AND chat_id = ?').get([msgId, chatId]);
    if (!msg || msg.sender_id !== senderId) continue;
    db.prepare('UPDATE messages SET deleted_at = ? WHERE id = ?').run([now, msgId]);
    deleted.push(msgId);
  }
  return deleted;
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

// ✅ NEW: pin a message
function pinMessage(chatId, messageId, requesterId) {
  const db = getDb();
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, requesterId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });
  const msg = db.prepare('SELECT id, chat_id FROM messages WHERE id = ? AND chat_id = ? AND deleted_at IS NULL').get([messageId, chatId]);
  if (!msg) throw Object.assign(new Error('Message not found'), { status: 404 });
  db.prepare('UPDATE messages SET is_pinned = 1 WHERE id = ?').run(messageId);
  return decryptMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId));
}

// ✅ NEW: unpin a message
function unpinMessage(chatId, messageId, requesterId) {
  const db = getDb();
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, requesterId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });
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
          is_system, forwarded_from_user_id, forwarded_from_username)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run([
      newId, targetChatId, senderId, ciphertext, iv, authTag, now,
      orig.attachment_url || null, orig.attachment_type || null,
      orig.attachment_name || null, orig.attachment_size || null,
      fwdUserId, fwdUsername,
    ]);

    results.push(decryptMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(newId)));
  }
  return results;
}

module.exports = { decryptMessage, saveMessage, getChatMessages, deleteMessages, toggleReaction, pinMessage, unpinMessage, getPinnedMessages, forwardMessages };
