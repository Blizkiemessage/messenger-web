/**
 * routes/search.js
 *
 * Global search endpoint.
 *   GET /search?q=<query>
 *
 * Returns:
 *   { users: User[], chats: ChatSummary[], messages: MessageResult[] }
 *
 * Messages are searchable via the search_text plaintext column (populated on
 * new messages). Old encrypted-only messages will not appear in results.
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { searchLimiter } = require('../middleware/rateLimits');
const { getDb } = require('../config/database');
const { searchUsers } = require('../services/userService');

const router = express.Router();
router.use(authMiddleware);

router.get('/', searchLimiter, (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 1) return res.json({ users: [], chats: [], messages: [] });

  const db = getDb();
  const userId = req.userId;
  // FTS5 prefix query: escape inner quotes, then wrap and add * for prefix match
  const ftsQuery = `"${q.replace(/"/g, '""')}"*`;

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
  const msgRows = db.prepare(`
    SELECT m.id, m.chat_id, m.search_text, m.created_at,
           c.name AS chat_name, c.type AS chat_type,
           u.display_name AS sender_display_name,
           u.username AS sender_username,
           partner.display_name AS partner_display_name,
           partner.username AS partner_username
    FROM messages m
    JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ?
    JOIN chats c ON c.id = m.chat_id
    JOIN users u ON u.id = m.sender_id
    LEFT JOIN chat_members cm2 ON cm2.chat_id = m.chat_id AND cm2.user_id != ? AND c.type = 'direct'
    LEFT JOIN users partner ON partner.id = cm2.user_id
    WHERE m.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)
      AND m.deleted_at IS NULL
      AND m.is_system = 0
    ORDER BY m.created_at DESC
    LIMIT 20
  `).all([userId, userId, ftsQuery]);

  const messages = msgRows.map(m => ({
    id: m.id,
    chat_id: m.chat_id,
    chat_type: m.chat_type,
    // For direct chats the server stores no name — use partner's display_name
    chat_name: m.chat_type === 'group'
      ? (m.chat_name || 'Группа')
      : (m.partner_display_name || m.partner_username || 'Пользователь'),
    text: m.search_text,
    sender_display_name: m.sender_display_name || m.sender_username || 'Пользователь',
    sender_username: m.sender_username || null,
    created_at: m.created_at,
  }));

  res.json({ users, chats: matchedChats, messages });
});

module.exports = router;
