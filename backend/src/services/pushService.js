const { getDb } = require('../config/database');
const { sendPush } = require('../utils/webPush');

/**
 * Fire-and-forget: send push notifications to offline members of a chat.
 * @param {string} chatId
 * @param {string} senderId  — the user who sent the message (skip them)
 * @param {string} text      — plain-text message body (truncated)
 * @param {object} io        — Socket.IO server instance (has io.onlineUsers Map)
 */
function fireAndForgetPush(chatId, senderId, text, io) {
  setImmediate(async () => {
    try {
      const db = getDb();

      // 1. Get all chat members except the sender
      const members = db
        .prepare('SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?')
        .all([chatId, senderId]);
      if (members.length === 0) return;

      // 2. Filter to offline members (not in io.onlineUsers)
      const onlineUsers = io.onlineUsers instanceof Map ? io.onlineUsers : new Map();
      const offlineIds = members
        .map(m => m.user_id)
        .filter(id => !onlineUsers.has(id));
      if (offlineIds.length === 0) return;

      // 3. Get sender display name
      const sender = db
        .prepare('SELECT display_name, username FROM users WHERE id = ?')
        .get(senderId);
      const senderName = sender?.display_name || sender?.username || 'Новое сообщение';

      // 4. Build notification payload
      const body = text ? text.slice(0, 120) : '📎 Вложение';
      const payload = { title: senderName, body, chatId };

      // 5. Load subscriptions and send
      const placeholders = offlineIds.map(() => '?').join(',');
      const subs = db
        .prepare(`SELECT id, endpoint, p256dh, auth_key FROM push_subscriptions WHERE user_id IN (${placeholders})`)
        .all(offlineIds);

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
      console.error('[PushService] fireAndForgetPush error:', err.message);
    }
  });
}

module.exports = { fireAndForgetPush };
