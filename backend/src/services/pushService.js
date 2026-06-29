const { getDb } = require('../config/database');
const { sendPush } = require('../utils/webPush');
const logger = require('../utils/logger');

const CUSTOM_EMOJI_RE = /:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:/gi;

/**
 * Build a human-readable notification body from message data.
 * Resolves :packId:itemId: custom emoji to their emoji_hint from the DB.
 */
function buildBody(db, { text, attachment_type, attachment_meta }) {
  // Sticker → look up emoji_hint or fallback icon
  if (attachment_type === 'sticker') {
    try {
      const meta = JSON.parse(attachment_meta || '{}');
      if (meta.itemId) {
        const item = db.prepare('SELECT emoji_hint FROM sticker_pack_items WHERE id = ?').get(meta.itemId);
        if (item?.emoji_hint) return `${item.emoji_hint} Стикер`;
      }
    } catch { /* ignore bad json */ }
    return '🎭 Стикер';
  }

  // Other non-text attachments
  if (!text && attachment_type) {
    const icons = {
      image:      '📷 Фото',
      video:      '🎥 Видео',
      video_note: '🎥 Видеосообщение',
      audio:      '🎵 Аудио',
      gif_tenor:  '🎞 GIF',
      gif_custom: '🎞 GIF',
    };
    return icons[attachment_type] || '📎 Вложение';
  }

  if (!text) return '📎 Вложение';

  // Resolve :packId:itemId: → emoji_hint in text
  CUSTOM_EMOJI_RE.lastIndex = 0;
  const resolved = text.replace(CUSTOM_EMOJI_RE, (match) => {
    try {
      const inner = match.slice(1, -1);               // "packId:itemId"
      const itemId = inner.slice(inner.indexOf(':') + 1);
      const row = db.prepare('SELECT emoji_hint FROM sticker_pack_items WHERE id = ?').get(itemId);
      return row?.emoji_hint || '😊';
    } catch { return '😊'; }
  });

  return resolved.slice(0, 120);
}

/**
 * Fire-and-forget: send push notifications to offline members of a chat.
 * @param {string} chatId
 * @param {string} senderId   — the user who sent the message (skip them)
 * @param {object} msgData    — { text, attachment_type, attachment_meta }
 * @param {object} io         — Socket.IO server instance (has io.onlineUsers Map)
 */
function fireAndForgetPush(chatId, senderId, msgData, io) {
  // Back-compat: old callers may pass a plain string
  if (typeof msgData === 'string') msgData = { text: msgData, attachment_type: null, attachment_meta: null };

  setImmediate(async () => {
    try {
      const db = getDb();

      // 1. Get all chat members except the sender
      const members = db
        .prepare('SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?')
        .all([chatId, senderId]);
      if (members.length === 0) return;

      // 2. Filter to offline members (not in io.onlineUsers).
      // onlineUsers is now a Map<userId, socketCount>; a user is online if count > 0.
      const onlineUsers = io.onlineUsers instanceof Map ? io.onlineUsers : new Map();
      const offlineIds = members
        .map(m => m.user_id)
        .filter(id => !(onlineUsers.get(id) > 0));
      if (offlineIds.length === 0) return;

      // 3a. Skip members who have muted this chat
      const placeholdersMute = offlineIds.map(() => '?').join(',');
      const mutedRows = db
        .prepare(`SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id IN (${placeholdersMute}) AND is_muted = 1`)
        .all([chatId, ...offlineIds]);
      const mutedSet = new Set(mutedRows.map(r => r.user_id));
      const eligibleIds = offlineIds.filter(id => !mutedSet.has(id));
      if (eligibleIds.length === 0) return;

      // 3. Get sender display name
      const sender = db
        .prepare('SELECT display_name, username FROM users WHERE id = ?')
        .get(senderId);
      const senderName = sender?.display_name || sender?.username || 'Новое сообщение';

      // 4. Build notification payload
      const body = buildBody(db, msgData);
      const payload = { title: senderName, body, chatId };

      // 5. Load subscriptions and send
      const placeholders = eligibleIds.map(() => '?').join(',');
      const subs = db
        .prepare(`SELECT id, endpoint, p256dh, auth_key FROM push_subscriptions WHERE user_id IN (${placeholders})`)
        .all(eligibleIds);

      for (const sub of subs) {
        const subscription = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth_key },
        };
        const ok = await sendPush(subscription, payload);
        // Remove expired subscriptions
        if (!ok) {
          db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        }
      }
    } catch (err) {
      logger.error('[Push]', 'Push notification failed', err, { chatId, senderId });
    }
  });
}

/**
 * Fire-and-forget: push the callee about an incoming call. Sent to ALL of the
 * callee's subscriptions (to wake a backgrounded/closed PWA). The SW suppresses
 * the notification if the app is already focused (in-app modal handles it).
 * @param {string} calleeId
 * @param {{ callId:string, callType:string, callerName:string, chatId:string }} info
 */
function sendCallPush(calleeId, { callId, callType, callerName, chatId }) {
  setImmediate(async () => {
    try {
      const db = getDb();
      const subs = db
        .prepare('SELECT id, endpoint, p256dh, auth_key FROM push_subscriptions WHERE user_id = ?')
        .all(calleeId);
      if (subs.length === 0) return;

      const payload = {
        type: 'call',
        title: callType === 'video' ? 'Входящий видеозвонок' : 'Входящий звонок',
        body: `${callerName} звонит…`,
        callId, chatId, callType,
      };

      for (const sub of subs) {
        const subscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } };
        const ok = await sendPush(subscription, payload);
        if (!ok) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      }
    } catch (err) {
      logger.error('[Push]', 'Call push failed', err, { calleeId });
    }
  });
}

module.exports = { fireAndForgetPush, sendCallPush };
