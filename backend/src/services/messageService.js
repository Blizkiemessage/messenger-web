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
    voice_waveform: msg.voice_waveform || null,
    liked_by: JSON.parse(msg.liked_by || '[]'),
    reactions: JSON.parse(msg.reactions || '[]'),
    is_system: msg.is_system ? true : false,
    is_pinned: msg.is_pinned ? true : false,
    forwarded_from_user_id: msg.forwarded_from_user_id || null,
    forwarded_from_username: msg.forwarded_from_username || null,
    poll_id: msg.poll_id || null,
    reply,
    edited_at: msg.edited_at || null,
    // F1: scheduled delivery fields
    deliver_at: msg.deliver_at || null,
    is_delivered: msg.is_delivered != null ? (msg.is_delivered ? true : false) : true,
  };
}

function getChatMessages(chatId, userId, { limit = 50, before = null } = {}) {
  const db = getDb();
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, userId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });
  // F1: exclude scheduled (undelivered) messages from the chat history
  const rows = before
    ? db.prepare(`SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL AND is_delivered = 1 AND created_at < ? AND id NOT IN (SELECT message_id FROM message_hidden WHERE user_id = ?) ORDER BY created_at DESC LIMIT ?`).all([chatId, before, userId, limit])
    : db.prepare(`SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL AND is_delivered = 1 AND id NOT IN (SELECT message_id FROM message_hidden WHERE user_id = ?) ORDER BY created_at DESC LIMIT ?`).all([chatId, userId, limit]);
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

/**
 * Core insert helper used by both saveMessage and saveScheduledMessage.
 * deliverAt: null = deliver immediately (is_delivered=1); number = scheduled (is_delivered=0)
 */
function _insertMessage(db, chatId, senderId, text, attachment, isSystem, reply, pollId, deliverAt) {
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

  const isScheduled = deliverAt != null;
  db.prepare(
    `INSERT INTO messages (id, chat_id, sender_id, ciphertext, iv, auth_tag, created_at,
       attachment_url, attachment_type, attachment_name, attachment_meta, attachment_size, attachment_duration,
       voice_waveform, is_system,
       reply_to_id, reply_to_sender_id, reply_to_sender_username,
       reply_to_ciphertext, reply_to_iv, reply_to_auth_tag, poll_id, search_text,
       deliver_at, is_delivered)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run([msgId, chatId, senderId, ciphertext, iv, authTag, now,
    attachment.attachment_url || null, attachment.attachment_type || null,
    attachment.attachment_name || null, attachment.attachment_meta || null,
    attachment.attachment_size || null,
    attachment.attachment_duration != null ? attachment.attachment_duration : null,
    typeof attachment.voice_waveform === 'string' ? attachment.voice_waveform : null,
    isSystem ? 1 : 0,
    replyToId, replyToSenderId, replyToSenderUsername,
    replyToCiphertext, replyToIv, replyToAuthTag,
    pollId || null,
    isSystem ? null : (text || null),
    isScheduled ? deliverAt : null,
    isScheduled ? 0 : 1,
  ]);

  return msgId;
}

function saveMessage(chatId, senderId, text, attachment = {}, isSystem = false, reply = null, pollId = null) {
  const db = getDb();
  if (!isSystem) {
    const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, senderId]);
    if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });
  }

  const msgId = _insertMessage(db, chatId, senderId, text, attachment, isSystem, reply, pollId, null);

  // Increment unread_count for all chat members except the sender
  db.prepare(`
    UPDATE chat_members SET unread_count = unread_count + 1
    WHERE chat_id = ? AND user_id != ?
  `).run([chatId, senderId]);

  return decryptMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId));
}

// ── F1: Scheduled / time-capsule messages ──────────────────────────────────

/**
 * Save a message for future delivery. Returns the scheduled message object.
 * The message is invisible to all until deliverAt is reached.
 */
function saveScheduledMessage(chatId, senderId, text, attachment = {}, reply = null, deliverAt) {
  const db = getDb();
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, senderId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });

  const msgId = _insertMessage(db, chatId, senderId, text, attachment, false, reply, null, deliverAt);
  return decryptMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId));
}

/**
 * Return the current user's pending (undelivered) scheduled messages in a chat.
 */
function getScheduledMessages(chatId, senderId) {
  const db = getDb();
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, senderId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });

  const rows = db.prepare(
    `SELECT * FROM messages
     WHERE chat_id = ? AND sender_id = ? AND is_delivered = 0 AND deleted_at IS NULL
     ORDER BY deliver_at ASC`
  ).all([chatId, senderId]);
  return rows.map(decryptMessage);
}

/**
 * Cancel (soft-delete) a scheduled message before it is delivered.
 * Only the sender can cancel their own scheduled message.
 */
function cancelScheduledMessage(chatId, senderId, msgId) {
  const db = getDb();
  const msg = db.prepare(
    `SELECT id, sender_id, attachment_url FROM messages
     WHERE id = ? AND chat_id = ? AND is_delivered = 0 AND deleted_at IS NULL`
  ).get([msgId, chatId]);
  if (!msg) throw Object.assign(new Error('Not found'), { status: 404 });
  if (msg.sender_id !== senderId) throw Object.assign(new Error('Forbidden'), { status: 403 });

  db.prepare('UPDATE messages SET deleted_at = ?, search_text = NULL WHERE id = ?').run([Date.now(), msgId]);
  if (msg.attachment_url) deleteFromS3(msg.attachment_url);
  return { ok: true };
}

/**
 * Edit text and/or delivery time of a not-yet-delivered scheduled message.
 * Only the sender can edit their own scheduled message.
 */
function updateScheduledMessage(chatId, senderId, msgId, { text, deliverAt }) {
  const db = getDb();
  const msg = db.prepare(
    `SELECT * FROM messages
     WHERE id = ? AND chat_id = ? AND sender_id = ? AND is_delivered = 0 AND deleted_at IS NULL`
  ).get([msgId, chatId, senderId]);
  if (!msg) throw Object.assign(new Error('Not found'), { status: 404 });

  const sets = [];
  const vals = [];

  if (text !== undefined) {
    const { ciphertext, iv, authTag } = encrypt(text.trim() || '');
    sets.push('ciphertext = ?', 'iv = ?', 'auth_tag = ?');
    vals.push(ciphertext, iv, authTag);
  }
  if (deliverAt !== undefined) {
    if (typeof deliverAt !== 'number' || deliverAt <= Date.now()) {
      throw Object.assign(new Error('deliver_at must be a future timestamp'), { status: 400 });
    }
    sets.push('deliver_at = ?');
    vals.push(deliverAt);
  }
  if (sets.length === 0) throw Object.assign(new Error('Nothing to update'), { status: 400 });

  vals.push(msgId);
  db.prepare(`UPDATE messages SET ${sets.join(', ')} WHERE id = ?`).run(vals);

  const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
  return decryptMessage(updated);
}

/**
 * Delivery job — called by a setInterval in socketServer.
 * Finds all messages whose deliver_at has passed, marks them delivered,
 * updates unread counts, and returns them grouped by chatId for socket broadcast.
 */
function deliverPendingMessages() {
  const db = getDb();
  const now = Date.now();
  const due = db.prepare(
    `SELECT * FROM messages
     WHERE is_delivered = 0 AND deliver_at <= ? AND deleted_at IS NULL`
  ).all(now);

  if (due.length === 0) return [];

  const deliverStmt   = db.prepare(
    'UPDATE messages SET is_delivered = 1, created_at = ? WHERE id = ?'
  );
  const unreadStmt    = db.prepare(
    `UPDATE chat_members SET unread_count = unread_count + 1
     WHERE chat_id = ? AND user_id != ?`
  );

  const delivered = [];
  for (const row of due) {
    deliverStmt.run(now, row.id);
    unreadStmt.run([row.chat_id, row.sender_id]);
    delivered.push(decryptMessage({ ...row, is_delivered: 1, created_at: now }));
  }
  return delivered;
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
    // Clear search_text alongside deleted_at so the FTS trigger removes the stale index entry
    db.prepare('UPDATE messages SET deleted_at = ?, search_text = NULL WHERE id = ?').run([now, msgId]);
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
  const trimmed = newText.trim();
  const { ciphertext, iv, authTag } = encrypt(trimmed);
  const now = Date.now();
  // search_text updated together with ciphertext so FTS index stays in sync
  db.prepare('UPDATE messages SET ciphertext = ?, iv = ?, auth_tag = ?, edited_at = ?, search_text = ? WHERE id = ?')
    .run([ciphertext, iv, authTag, now, trimmed, msgId]);
  return decryptMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId));
}

/**
 * getChatMedia — returns paginated messages that have attachments or URLs, filtered by tab.
 * Tabs: 'media' (image/video/gif), 'audio', 'files' (documents), 'stickers', 'links' (messages with URLs).
 * Returns { items: Message[], hasMore: boolean }.
 */
function getChatMedia(chatId, userId, { tab = 'media', limit = 30, before = null } = {}) {
  const db = getDb();
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, userId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });

  let typeFilter;
  switch (tab) {
    case 'media':
      typeFilter = `attachment_type IN ('image','video','video_note','gif_tenor','gif_custom')`;
      break;
    case 'audio':
      typeFilter = `attachment_type = 'audio'`;
      break;
    case 'files':
      // Everything with an attachment that isn't a known media/audio/sticker type
      typeFilter = `attachment_type IS NOT NULL AND attachment_type NOT IN ('image','video','video_note','gif_tenor','gif_custom','audio','sticker')`;
      break;
    case 'stickers':
      typeFilter = `attachment_type = 'sticker'`;
      break;
    case 'links':
      // Messages whose decrypted text contains a URL — we search the search_text index column
      typeFilter = `(search_text LIKE '%http://%' OR search_text LIKE '%https://%')`;
      break;
    default:
      typeFilter = `attachment_type IS NOT NULL`;
  }

  const fetchLimit = limit + 1; // fetch one extra to detect whether there is a next page
  const rows = before
    ? db.prepare(`SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL AND ${typeFilter} AND created_at < ? ORDER BY created_at DESC LIMIT ?`).all([chatId, before, fetchLimit])
    : db.prepare(`SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL AND ${typeFilter} ORDER BY created_at DESC LIMIT ?`).all([chatId, fetchLimit]);

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();

  return { items: rows.map(decryptMessage), hasMore };
}

module.exports = {
  decryptMessage, saveMessage, getChatMessages,
  deleteMessages, hideMessages,
  toggleReaction, toggleEmojiReaction,
  pinMessage, unpinMessage, getPinnedMessages,
  forwardMessages, editMessage, getChatMedia,
  // F1: scheduled messages
  saveScheduledMessage, getScheduledMessages, cancelScheduledMessage,
  updateScheduledMessage, deliverPendingMessages,
};
