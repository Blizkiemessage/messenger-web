/**
 * routes/search.js
 *
 * Global search endpoint.
 *   GET /search?q=<query>
 *
 * Returns:
 *   { users: User[], chats: ChatSummary[], messages: MessageResult[] }
 *
 * Messages are searched by decrypting candidate rows in memory — no plaintext
 * is stored at rest (see messageService.searchMessages).
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { searchLimiter } = require('../middleware/rateLimits');
const { getDb } = require('../config/database');
const { searchUsers } = require('../services/userService');
const { searchMessages } = require('../services/messageService');
const { signUserAvatars, signAvatarUrl } = require('../utils/s3Sign');

const router = express.Router();
router.use(authMiddleware);

router.get('/', searchLimiter, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 1) return res.json({ users: [], chats: [], messages: [] });

  const db = getDb();
  const userId = req.userId;

  // ── 1. Users ────────────────────────────────────────────────────────────────
  const users = searchUsers(q, userId);

  // ── 2. Chats from user's memberships ────────────────────────────────────────
  // Fetch all chats the user is a member of, along with partner info for directs
  const userChats = db.prepare(`
    SELECT c.id, c.type, c.name, c.avatar_url, c.description,
           cm2.user_id AS partner_id,
           u2.display_name AS partner_display_name,
           u2.username AS partner_username,
           u2.avatar_url AS partner_avatar_url
    FROM chats c
    JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = ?
    LEFT JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id != ? AND c.type = 'direct'
    LEFT JOIN users u2 ON u2.id = cm2.user_id
  `).all([userId, userId]);

  const matchedChats = userChats.filter(c => {
    if (c.type === 'group') {
      return c.name && c.name.toLowerCase().includes(q.toLowerCase());
    }
    // direct: match partner name or username
    const partnerName = (c.partner_display_name || '').toLowerCase();
    const partnerUser = (c.partner_username || '').toLowerCase();
    return partnerName.includes(q.toLowerCase()) || partnerUser.includes(q.toLowerCase());
  }).slice(0, 10).map(c => ({
    id: c.id,
    type: c.type,
    name: c.type === 'group' ? c.name : (c.partner_display_name || c.partner_username || 'Пользователь'),
    avatar_url: c.type === 'group' ? c.avatar_url : c.partner_avatar_url,
    partner_id: c.partner_id || null,
    partner_username: c.partner_username || null,
  }));

  // ── 3. Messages ──────────────────────────────────────────────────────────────
  // No plaintext is stored: searchMessages decrypts candidate rows in memory and
  // substring-matches the query (see messageService.searchMessages).
  const messages = searchMessages(userId, q).map(m => ({
    id: m.id,
    chat_id: m.chat_id,
    chat_type: m.chat_type,
    // For direct chats the server stores no name — use partner's display_name
    chat_name: m.chat_type === 'group'
      ? (m.chat_name || 'Группа')
      : (m.partner_display_name || m.partner_username || 'Пользователь'),
    text: m.text,
    sender_display_name: m.sender_display_name || m.sender_username || 'Пользователь',
    sender_username: m.sender_username || null,
    created_at: m.created_at,
  }));

  // Sign avatar URLs before sending
  await signUserAvatars(users);
  await Promise.all(matchedChats.map(async (c) => {
    if (c.avatar_url) c.avatar_url = await signAvatarUrl(c.avatar_url);
  }));

  res.json({ users, chats: matchedChats, messages });
});

module.exports = router;
