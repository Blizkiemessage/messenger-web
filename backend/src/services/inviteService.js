'use strict';

/**
 * inviteService.js — постоянные личные пригласительные ссылки (Этап B).
 *
 * Намеренно НЕ вызывает getChatById — возвращает только chatId; обогащение чата
 * (для ответа клиенту и сокета) делает роут. Это держит сервис тестируемым на
 * минимальной схеме.
 */
const crypto = require('crypto');
const { getDb } = require('../config/database');

function genToken() {
  return crypto.randomBytes(9).toString('base64url'); // ~12 url-safe символов
}

function pairKey(a, b) { return a < b ? [a, b] : [b, a]; }

function getActiveToken(db, userId) {
  return db
    .prepare('SELECT token, used_count FROM invite_tokens WHERE inviter_id = ? AND revoked = 0 ORDER BY created_at DESC LIMIT 1')
    .get(userId);
}

/** Вернуть активную ссылку пользователя или создать первую. */
function getOrCreateMyToken(userId) {
  const db = getDb();
  let row = getActiveToken(db, userId);
  if (!row) {
    const token = genToken();
    db.prepare('INSERT INTO invite_tokens (token, inviter_id, created_at) VALUES (?, ?, ?)')
      .run([token, userId, Date.now()]);
    row = { token, used_count: 0 };
  }
  return { token: row.token, used_count: row.used_count };
}

/** Отозвать активную ссылку и выпустить новую. */
function regenerateMyToken(userId) {
  const db = getDb();
  db.prepare('UPDATE invite_tokens SET revoked = 1 WHERE inviter_id = ? AND revoked = 0').run(userId);
  const token = genToken();
  db.prepare('INSERT INTO invite_tokens (token, inviter_id, created_at) VALUES (?, ?, ?)')
    .run([token, userId, Date.now()]);
  return { token, used_count: 0 };
}

/** Публичная инфа о пригласившем для лендинга (без чувствительных полей). */
function resolveToken(token) {
  const db = getDb();
  const row = db.prepare('SELECT inviter_id FROM invite_tokens WHERE token = ? AND revoked = 0').get(token);
  if (!row) throw Object.assign(new Error('Ссылка недействительна или отозвана'), { status: 404 });
  const u = db.prepare('SELECT id, username, display_name, avatar_url FROM users WHERE id = ?').get(row.inviter_id);
  if (!u) throw Object.assign(new Error('Ссылка недействительна'), { status: 404 });
  return { inviter: { id: u.id, username: u.username, display_name: u.display_name, avatar_url: u.avatar_url } };
}

function isBlockedEither(db, a, b) {
  const row = db.prepare(
    'SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1'
  ).get([a, b, b, a]);
  return !!row;
}

/** Найти существующий ЛС-чат двух юзеров или создать новый. Возвращает chatId. */
function getOrCreateDirectChatId(db, userAId, userBId) {
  const existing = db.prepare(
    `SELECT c.id FROM chats c
     JOIN chat_members cm1 ON cm1.chat_id = c.id AND cm1.user_id = ?
     JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id = ?
     WHERE c.type = 'direct' LIMIT 1`
  ).get([userAId, userBId]);
  if (existing) return existing.id;

  const chatId = crypto.randomUUID();
  const now = Date.now();
  db.exec('BEGIN');
  try {
    db.prepare("INSERT INTO chats (id, type, created_at) VALUES (?, 'direct', ?)").run([chatId, now]);
    db.prepare('INSERT INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)').run([chatId, userAId, now]);
    db.prepare('INSERT INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)').run([chatId, userBId, now]);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return chatId;
}

/**
 * Принять ссылку залогиненным пользователем: сделать друзьями + создать/найти ЛС.
 * Возвращает { self } | { chatId, inviterId }. Обогащение чата — на стороне роута.
 */
function acceptToken(token, accepterId) {
  const db = getDb();
  const row = db.prepare('SELECT inviter_id FROM invite_tokens WHERE token = ? AND revoked = 0').get(token);
  if (!row) throw Object.assign(new Error('Ссылка недействительна или отозвана'), { status: 404 });
  const inviterId = row.inviter_id;
  if (inviterId === accepterId) return { self: true };
  if (isBlockedEither(db, inviterId, accepterId)) {
    throw Object.assign(new Error('Невозможно принять приглашение'), { status: 403 });
  }

  const [x, y] = pairKey(inviterId, accepterId);
  const now = Date.now();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT OR IGNORE INTO friends (user_a_id, user_b_id, created_at) VALUES (?, ?, ?)').run([x, y, now]);
    db.prepare(
      'DELETE FROM friend_requests WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)'
    ).run([inviterId, accepterId, accepterId, inviterId]);
    db.prepare('UPDATE invite_tokens SET used_count = used_count + 1, last_used_at = ? WHERE token = ?').run([now, token]);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  const chatId = getOrCreateDirectChatId(db, accepterId, inviterId);
  return { chatId, inviterId };
}

module.exports = {
  getOrCreateMyToken, regenerateMyToken, resolveToken, acceptToken,
};
