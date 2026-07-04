'use strict';

/**
 * services/moderationService.js — admin actions on a confirmed UGC violation:
 * ban/unban a user, or send them a warning. Session revocation reuses the
 * exact mechanism already relied on for logout/revoked-session handling
 * (sessions.revoked checked in middleware/auth.js, live sockets swept via
 * io.kickSession) — banning introduces no new enforcement path, just flips
 * the same switch. Stays io-agnostic like services/chat/teardown.js: returns
 * the affected session ids, the calling route decides what to do with `io`.
 */
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');

function banUser(userId, reason, adminId) {
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if (userId === adminId) throw Object.assign(new Error('Нельзя заблокировать самого себя'), { status: 400 });

  const now = Date.now();
  const cleanReason = (reason || '').trim().slice(0, 500) || null;

  db.prepare(
    'UPDATE users SET is_banned = 1, ban_reason = ?, banned_at = ? WHERE id = ?'
  ).run([cleanReason, now, userId]);

  const sessionIds = db.prepare('SELECT id FROM sessions WHERE user_id = ? AND revoked = 0').all(userId).map(r => r.id);
  db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ?').run(userId);
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(userId);

  return { ok: true, sessionIds };
}

function unbanUser(userId) {
  const db = getDb();
  const result = db.prepare(
    'UPDATE users SET is_banned = 0, ban_reason = NULL, banned_at = NULL WHERE id = ?'
  ).run(userId);
  if (result.changes === 0) throw Object.assign(new Error('User not found'), { status: 404 });
  return { ok: true };
}

function warnUser(userId, message, adminId, reportId) {
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

  const cleanMessage = (message || '').trim().slice(0, 1000);
  if (!cleanMessage) throw Object.assign(new Error('Текст предупреждения обязателен'), { status: 400 });

  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    'INSERT INTO user_warnings (id, user_id, admin_id, message, report_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run([id, userId, adminId || null, cleanMessage, reportId || null, now]);

  if (reportId) {
    db.prepare('UPDATE content_reports SET resolved = 1 WHERE id = ?').run(reportId);
  }

  return { id, user_id: userId, message: cleanMessage, created_at: now };
}

/** Ban status + warning history for the admin's investigate/detail view. */
function getModerationInfo(userId) {
  const db = getDb();
  const user = db.prepare(
    'SELECT is_banned, ban_reason, banned_at FROM users WHERE id = ?'
  ).get(userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

  const warnings = db.prepare(
    `SELECT uw.*, au.username AS admin_username
     FROM user_warnings uw
     LEFT JOIN users au ON uw.admin_id = au.id
     WHERE uw.user_id = ?
     ORDER BY uw.created_at DESC`
  ).all(userId);

  return { ...user, warnings };
}

/** Unacknowledged warnings for the user themselves (routes/users.js). */
function getUnacknowledgedWarnings(userId) {
  return getDb().prepare(
    'SELECT id, message, created_at FROM user_warnings WHERE user_id = ? AND acknowledged_at IS NULL ORDER BY created_at ASC'
  ).all(userId);
}

function acknowledgeWarning(userId, warningId) {
  const db = getDb();
  const result = db.prepare(
    'UPDATE user_warnings SET acknowledged_at = ? WHERE id = ? AND user_id = ? AND acknowledged_at IS NULL'
  ).run([Date.now(), warningId, userId]);
  if (result.changes === 0) throw Object.assign(new Error('Warning not found'), { status: 404 });
  return { ok: true };
}

module.exports = {
  banUser, unbanUser, warnUser, getModerationInfo,
  getUnacknowledgedWarnings, acknowledgeWarning,
};
