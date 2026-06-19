/**
 * services/chat/queries.js — read models for chats.
 *   getChatById  — single chat with members, last message, per-user fields
 *   getUserChats — all chats for a user (batched queries)
 *
 * getChatById is the shared building block reused by create/members/etc.
 */
const { getDb } = require('../../config/database');
const { sanitizeUser } = require('../userService');
const { decryptMessage } = require('../messageService');
const { parseModeratorPermissions } = require('../chatPermissions');

/**
 * Build a full chat object from the DB for the given user.
 * Returns null if the chat doesn't exist or the user isn't a member.
 */
function getChatById(chatId, userId) {
  const db = getDb();

  const chat = db
    .prepare(
      'SELECT id, type, name, description, avatar_url, created_at, creator_id, is_closed, chat_bg, chat_bg_updated_at FROM chats WHERE id = ?'
    )
    .get(chatId);
  if (!chat) return null;

  // Fetch all members + their last_read_at + role in one query (membership check included)
  const rawMembers = db.prepare(`
    SELECT cm.last_read_at AS member_last_read_at, cm.role, cm.permissions AS member_permissions,
           u.id, u.username, u.display_name, u.avatar_url, u.last_seen_at,
           u.hide_avatar, u.avatar_exceptions,
           u.presence_status, u.presence_note, u.presence_expires_at
    FROM chat_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.chat_id = ?
  `).all(chatId);

  if (!rawMembers.some(m => m.id === userId)) return null;

  const otherIds = rawMembers.filter(m => m.id !== userId).map(m => m.id);

  // Batch load aliases for all other members
  const aliasMap = {};
  if (otherIds.length) {
    const phs = otherIds.map(() => '?').join(',');
    db.prepare(`SELECT target_id, alias FROM contact_aliases WHERE user_id = ? AND target_id IN (${phs})`)
      .all([userId, ...otherIds])
      .forEach(a => { aliasMap[a.target_id] = a.alias; });
  }

  // Batch load who among other members has blocked me
  const blockedByThem = new Set();
  if (otherIds.length) {
    const phs = otherIds.map(() => '?').join(',');
    db.prepare(`SELECT blocker_id FROM blocked_users WHERE blocked_id = ? AND blocker_id IN (${phs})`)
      .all([userId, ...otherIds])
      .forEach(b => blockedByThem.add(b.blocker_id));
  }

  const members = rawMembers.map(u => {
    const alias = u.id !== userId ? (aliasMap[u.id] || null) : null;
    const sanitized = sanitizeUser(u, { viewerId: userId }, alias);
    if (u.id !== userId) {
      sanitized.blocked_by_them = blockedByThem.has(u.id);
    }
    sanitized.role = u.role || 'member';
    sanitized.permissions = parseModeratorPermissions(u.role, u.member_permissions);
    return sanitized;
  });

  // F1: exclude scheduled (undelivered) messages from last_message
  const lastMsg = db
    .prepare(
      'SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL AND is_delivered = 1 ORDER BY created_at DESC LIMIT 1'
    )
    .get(chatId);

  // partner_last_read_at derived from already-loaded rawMembers — no extra query
  const partner = chat.type === 'direct' ? rawMembers.find(m => m.id !== userId) : null;
  const partner_last_read_at = partner
    ? (partner.member_last_read_at ?? 0)
    : chat.type === 'group'
      ? Math.max(0, ...rawMembers.filter(m => m.id !== userId).map(m => m.member_last_read_at ?? 0))
      : 0;

  // Личный фон этого пользователя в этом чате (если задан)
  const personalBg = db
    .prepare('SELECT bg, updated_at FROM chat_backgrounds WHERE user_id = ? AND chat_id = ?')
    .get([userId, chatId]);

  return {
    ...chat,
    is_closed: chat.is_closed === 1,
    members,
    last_message: lastMsg ? decryptMessage(lastMsg) : null,
    unread_count: 0,
    partner_last_read_at,
    chat_bg_updated_at: chat.chat_bg_updated_at || null,
    my_chat_bg: personalBg?.bg || null,
    my_chat_bg_updated_at: personalBg?.updated_at || null,
  };
}

function getUserChats(userId) {
  const db = getDb();

  // 1. All chats for this user + their membership row
  const rows = db.prepare(`
    SELECT c.id, c.type, c.name, c.description, c.avatar_url, c.created_at,
           c.creator_id, c.is_closed, c.chat_bg, c.chat_bg_updated_at,
           cm.is_pinned, cm.pin_order, cm.is_muted, cm.last_read_at AS my_last_read_at,
           cm.unread_count
    FROM chats c
    JOIN chat_members cm ON cm.chat_id = c.id
    WHERE cm.user_id = ?
    ORDER BY c.created_at DESC
  `).all(userId);

  if (!rows.length) return [];

  const chatIds = rows.map(r => r.id);
  const placeholders = chatIds.map(() => '?').join(',');

  // Личные фоны этого пользователя по всем его чатам — одним запросом
  const personalBgRows = db
    .prepare(`SELECT chat_id, bg, updated_at FROM chat_backgrounds WHERE user_id = ? AND chat_id IN (${placeholders})`)
    .all([userId, ...chatIds]);
  const personalBgByChat = {};
  const personalBgAtByChat = {};
  for (const r of personalBgRows) {
    personalBgByChat[r.chat_id] = r.bg;
    personalBgAtByChat[r.chat_id] = r.updated_at;
  }

  // 2. All members of all chats in one query
  const allMembers = db.prepare(`
    SELECT cm.chat_id, cm.last_read_at AS member_last_read_at, cm.role, cm.permissions AS member_permissions,
           u.id, u.username, u.display_name, u.avatar_url, u.last_seen_at,
           u.hide_avatar, u.avatar_exceptions,
           u.presence_status, u.presence_note, u.presence_expires_at
    FROM chat_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.chat_id IN (${placeholders})
  `).all(chatIds);

  // 3. Latest delivered message per chat in one query (F1: exclude scheduled)
  const lastMessages = db.prepare(`
    SELECT m.*
    FROM messages m
    INNER JOIN (
      SELECT chat_id, MAX(created_at) AS max_ts
      FROM messages
      WHERE chat_id IN (${placeholders}) AND deleted_at IS NULL AND is_delivered = 1
      GROUP BY chat_id
    ) latest ON m.chat_id = latest.chat_id AND m.created_at = latest.max_ts
    WHERE m.deleted_at IS NULL AND m.is_delivered = 1
  `).all(chatIds);

  // 4. (removed — unread_count now read directly from chat_members.unread_count)

  // 5. All contact aliases for this user in one query
  const allAliases = db.prepare(`
    SELECT target_id, alias FROM contact_aliases WHERE user_id = ?
  `).all(userId);

  // 6. All block relationships involving this user in one query
  const allBlocks = db.prepare(`
    SELECT blocker_id, blocked_id FROM blocked_users
    WHERE blocker_id = ? OR blocked_id = ?
  `).all([userId, userId]);

  // ── Build lookup maps ─────────────────────────────────────────────────────
  const membersByChat = {};
  for (const m of allMembers) {
    (membersByChat[m.chat_id] ??= []).push(m);
  }

  const lastMsgByChat = {};
  for (const m of lastMessages) lastMsgByChat[m.chat_id] = m;

  const aliasMap = {};
  for (const a of allAliases) aliasMap[a.target_id] = a.alias;

  const blockedByThem = new Set();
  for (const b of allBlocks) {
    if (b.blocked_id === userId) blockedByThem.add(b.blocker_id);
  }

  // ── Assemble result ───────────────────────────────────────────────────────
  return rows.map(chat => {
    const rawMembers = membersByChat[chat.id] || [];
    const members = rawMembers.map(u => {
      const alias = u.id !== userId ? (aliasMap[u.id] || null) : null;
      const sanitized = sanitizeUser(u, { viewerId: userId }, alias);
      if (u.id !== userId) {
        sanitized.blocked_by_them = blockedByThem.has(u.id);
      }
      sanitized.role = u.role || 'member';
      sanitized.permissions = parseModeratorPermissions(u.role, u.member_permissions);
      return sanitized;
    });

    const lastMsg = lastMsgByChat[chat.id] || null;

    const partner = chat.type === 'direct' ? rawMembers.find(m => m.id !== userId) : null;
    const partner_last_read_at = partner
      ? (partner.member_last_read_at ?? 0)
      : chat.type === 'group'
        ? Math.max(0, ...rawMembers.filter(m => m.id !== userId).map(m => m.member_last_read_at ?? 0))
        : 0;

    return {
      id:          chat.id,
      type:        chat.type,
      name:        chat.name,
      description: chat.description,
      avatar_url:  chat.avatar_url,
      created_at:  chat.created_at,
      creator_id:  chat.creator_id,
      is_closed:   chat.is_closed  === 1,
      is_pinned:   chat.is_pinned  === 1,
      pin_order:   chat.pin_order  ?? null,
      is_muted:    chat.is_muted   === 1,
      chat_bg:     chat.chat_bg || null,
      chat_bg_updated_at: chat.chat_bg_updated_at || null,
      my_chat_bg:  personalBgByChat[chat.id] || null,
      my_chat_bg_updated_at: personalBgAtByChat[chat.id] || null,
      members,
      last_message: lastMsg ? decryptMessage(lastMsg) : null,
      unread_count: chat.unread_count || 0,
      partner_last_read_at,
    };
  });
}

module.exports = { getChatById, getUserChats };
