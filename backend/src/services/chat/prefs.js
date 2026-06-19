/**
 * services/chat/prefs.js — per-user chat preferences (pin / mute / order).
 *   togglePinChat, toggleMuteChat, updateChatPinOrder
 */
const { getDb } = require('../../config/database');

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

module.exports = { togglePinChat, toggleMuteChat, updateChatPinOrder };
