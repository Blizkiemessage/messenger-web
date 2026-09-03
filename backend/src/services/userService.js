/**
 * userService.js
 * ✅ Added: hide_avatar, avatar_exceptions fields.
 *    When hide_avatar=true, avatar_url is hidden from other users
 *    unless their ID is in avatar_exceptions JSON array.
 */
const bcrypt = require('bcryptjs');
const { getDb } = require('../config/database');
const { verifyTotp, verifyAndConsumeBackupCode } = require('../utils/totp');

// Permanent, login-less placeholder user that orphaned references (messages,
// calls, chat notes) are reassigned to on account deletion instead of being
// deleted themselves — see db/versions/017_deleted_account_ghost.js and
// services/chat/teardown.js.
const DELETED_ACCOUNT_USER_ID = 'deleted-account';

// Kept in sync with web/src/utils/accent.ts's DEFAULT_ACCENT — the «Аврора»
// brand purple. The users.accent_color column still carries the pre-redesign
// blue '#2f81f7' as its own DB DEFAULT (db/versions/001_initial.js, an applied
// migration that must not be rewritten), so every code path that creates a user
// or falls back for a missing value has to name this constant explicitly.
const DEFAULT_ACCENT_COLOR = '#8e75f2';

function sanitizeUser(u, { showPrivate = false, viewerId = null } = {}, alias = undefined) {
  if (!u) return null;

  // ✅ Hide avatar from others unless they're in exceptions
  let avatarUrl = u.avatar_url;
  if (!showPrivate && u.hide_avatar) {
    const exceptions = JSON.parse(u.avatar_exceptions || '[]');
    if (!viewerId || !exceptions.includes(viewerId)) {
      avatarUrl = null;
    }
  }

  // ✅ Apply per-viewer alias override
  const displayName = (alias && !showPrivate) ? alias : u.display_name;

  return {
    id:           u.id,
    username:     u.username,
    display_name: displayName,
    avatar_url:   avatarUrl,
    // Hide last_seen_at from others if user has opted in to privacy
    last_seen_at: (!showPrivate && u.hide_last_seen) ? null : (u.last_seen_at ?? null),
    email:        (showPrivate || !u.hide_email)       ? (u.email      || null) : null,
    bio:          (showPrivate || !u.hide_bio)        ? (u.bio        || null) : null,
    birth_date:   (showPrivate || !u.hide_birth_date) ? (u.birth_date || null) : null,
    // Private flags — only sent back to the user themselves
    hide_email:        showPrivate ? (u.hide_email        ? true : false) : undefined,
    hide_bio:          showPrivate ? (u.hide_bio          ? true : false) : undefined,
    hide_birth_date:   showPrivate ? (u.hide_birth_date   ? true : false) : undefined,
    no_group_add:      showPrivate ? (u.no_group_add      ? true : false) : undefined,
    hide_avatar:       showPrivate ? (u.hide_avatar       ? true : false) : undefined,
    avatar_exceptions: showPrivate ? (u.avatar_exceptions || '[]')        : undefined,
    hide_last_seen:    showPrivate ? (u.hide_last_seen    ? true : false) : undefined,
    has_password:      showPrivate ? !!u.password_hash : undefined,
    totp_enabled:      showPrivate ? (u.totp_enabled ? true : false) : undefined,
    // Appearance — always returned to self (showPrivate), ignored for others
    theme:        showPrivate ? (u.theme        || 'dark')     : undefined,
    accent_color: showPrivate ? (u.accent_color || DEFAULT_ACCENT_COLOR) : undefined,
    app_bg:       showPrivate ? (u.app_bg       || null)       : undefined,
    language:     showPrivate ? (u.language     || 'ru')       : undefined,
    // F3: presence intention status — intentionally visible to chat members (not sensitive)
    presence_status:     u.presence_status     || null,
    presence_note:       u.presence_note       || null,
    presence_expires_at: u.presence_expires_at || null,
  };
}

function getUserById(userId) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId) ?? null;
}

const VALID_LANGUAGES = ['ru', 'en'];

function updateUser(userId, {
  username, display_name, avatar_url, bio,
  birth_date, hide_bio, hide_birth_date, hide_email, no_group_add,
  hide_avatar, avatar_exceptions, hide_last_seen,
  theme, accent_color, app_bg, language,
}) {
  const db = getDb();

  if (username !== undefined && username !== null) {
    const clean = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,32}$/.test(clean)) {
      throw Object.assign(new Error('Invalid username'), { status: 400 });
    }
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run([clean, userId]);
  }
  if (display_name     !== undefined) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run([display_name, userId]);
  if (avatar_url       !== undefined) db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run([avatar_url, userId]);
  if (bio              !== undefined) db.prepare('UPDATE users SET bio = ? WHERE id = ?').run([bio, userId]);
  if (birth_date       !== undefined) db.prepare('UPDATE users SET birth_date = ? WHERE id = ?').run([birth_date, userId]);
  if (hide_email       !== undefined) db.prepare('UPDATE users SET hide_email = ? WHERE id = ?').run([hide_email ? 1 : 0, userId]);
  if (hide_bio         !== undefined) db.prepare('UPDATE users SET hide_bio = ? WHERE id = ?').run([hide_bio ? 1 : 0, userId]);
  if (hide_birth_date  !== undefined) db.prepare('UPDATE users SET hide_birth_date = ? WHERE id = ?').run([hide_birth_date ? 1 : 0, userId]);
  if (no_group_add     !== undefined) db.prepare('UPDATE users SET no_group_add = ? WHERE id = ?').run([no_group_add ? 1 : 0, userId]);
  // ✅ NEW
  if (hide_avatar      !== undefined) db.prepare('UPDATE users SET hide_avatar = ? WHERE id = ?').run([hide_avatar ? 1 : 0, userId]);
  if (avatar_exceptions !== undefined) db.prepare('UPDATE users SET avatar_exceptions = ? WHERE id = ?').run([avatar_exceptions, userId]);
  if (hide_last_seen   !== undefined) db.prepare('UPDATE users SET hide_last_seen = ? WHERE id = ?').run([hide_last_seen ? 1 : 0, userId]);
  if (theme            !== undefined) db.prepare('UPDATE users SET theme = ? WHERE id = ?').run([theme, userId]);
  if (accent_color     !== undefined) db.prepare('UPDATE users SET accent_color = ? WHERE id = ?').run([accent_color, userId]);
  if (app_bg           !== undefined) {
    // JSON-строка настройки фона (см. appBackground.ts) либо null = дефолт
    if (app_bg !== null && (typeof app_bg !== 'string' || app_bg.length > 500)) {
      throw Object.assign(new Error('Invalid app_bg'), { status: 400 });
    }
    db.prepare('UPDATE users SET app_bg = ? WHERE id = ?').run([app_bg, userId]);
  }
  if (language !== undefined) {
    if (!VALID_LANGUAGES.includes(language)) {
      throw Object.assign(new Error('Invalid language'), { status: 400 });
    }
    db.prepare('UPDATE users SET language = ? WHERE id = ?').run([language, userId]);
  }

  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

function searchUsers(q, excludeId) {
  const like = `%${q.toLowerCase()}%`;
  return getDb()
    .prepare(
      `SELECT id, username, display_name, avatar_url, last_seen_at, no_group_add, hide_avatar, avatar_exceptions
       FROM users
       WHERE id != ? AND id != ? AND (LOWER(username) LIKE ? OR LOWER(display_name) LIKE ?)
       LIMIT 20`
    )
    .all([excludeId, DELETED_ACCOUNT_USER_ID, like, like])
    .map(u => ({
      ...sanitizeUser(u, { viewerId: excludeId }),
      no_group_add: u.no_group_add ? true : false,
    }));
}

function toggleBlockUser(blockerId, blockedId) {
  const db = getDb();
  const existing = db.prepare('SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').get([blockerId, blockedId]);
  if (existing) {
    db.prepare('DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').run([blockerId, blockedId]);
    return { is_blocked: false };
  } else {
    db.prepare('INSERT INTO blocked_users (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run([blockerId, blockedId, Date.now()]);
    return { is_blocked: true };
  }
}

function isBlocked(blockerId, blockedId) {
  return !!getDb().prepare('SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').get([blockerId, blockedId]);
}

function setContactAlias(userId, targetId, alias) {
  const db = getDb();
  // Use DELETE + INSERT for compatibility with older SQLite (avoid UPSERT syntax)
  db.prepare('DELETE FROM contact_aliases WHERE user_id = ? AND target_id = ?').run([userId, targetId]);
  db.prepare('INSERT INTO contact_aliases (user_id, target_id, alias, created_at) VALUES (?, ?, ?, ?)').run([userId, targetId, alias, Date.now()]);
  return { alias };
}

function deleteContactAlias(userId, targetId) {
  getDb().prepare('DELETE FROM contact_aliases WHERE user_id = ? AND target_id = ?').run([userId, targetId]);
  return { alias: null };
}

function getContactAlias(userId, targetId) {
  return getDb().prepare('SELECT alias FROM contact_aliases WHERE user_id = ? AND target_id = ?').get([userId, targetId])?.alias ?? null;
}

const VALID_STATUSES = ['free', 'busy', 'dnd'];

/**
 * Update (or clear) the presence intention status for a user.
 * status=null clears the status entirely.
 */
function updatePresenceStatus(userId, { status, note, expires_at }) {
  if (status !== null && status !== undefined && !VALID_STATUSES.includes(status)) {
    throw Object.assign(new Error('Неверный статус. Допустимые значения: free, busy, dnd'), { status: 400 });
  }
  const trimmedNote = (note && typeof note === 'string') ? note.trim().slice(0, 100) : null;
  const db = getDb();
  db.prepare(
    'UPDATE users SET presence_status = ?, presence_note = ?, presence_expires_at = ? WHERE id = ?'
  ).run(status || null, trimmedNote || null, expires_at || null, userId);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

/**
 * Clear all expired presence statuses.
 * Returns array of userId strings whose status was cleared.
 */
function clearExpiredPresenceStatuses() {
  const db = getDb();
  const now = Date.now();
  const expired = db.prepare(
    'SELECT id FROM users WHERE presence_expires_at IS NOT NULL AND presence_expires_at < ? AND presence_status IS NOT NULL'
  ).all(now);
  if (expired.length > 0) {
    db.prepare(
      'UPDATE users SET presence_status = NULL, presence_note = NULL, presence_expires_at = NULL WHERE presence_expires_at < ? AND presence_expires_at IS NOT NULL'
    ).run(now);
  }
  return expired.map(r => r.id);
}

/**
 * Re-authenticates a user before an irreversible action (account deletion).
 * Requires the current password, plus a valid TOTP/backup code when 2FA is
 * enabled — a valid session alone isn't enough, since a session left open on
 * a shared device would otherwise let anyone delete the account in one request.
 * Throws Object.assign(new Error(msg), {status}) on failure; resolves on success.
 */
async function verifyAccountDeletionAuth(userId, password, code) {
  if (!password || typeof password !== 'string') {
    throw Object.assign(new Error('Введите пароль для подтверждения'), { status: 400 });
  }

  const db  = getDb();
  const row = db.prepare(
    'SELECT password_hash, totp_enabled, totp_secret FROM users WHERE id = ?'
  ).get(userId);
  if (!row) throw Object.assign(new Error('User not found'), { status: 404 });

  const passwordValid = row.password_hash ? await bcrypt.compare(password, row.password_hash) : false;
  if (!passwordValid) throw Object.assign(new Error('Неверный пароль'), { status: 401 });

  if (row.totp_enabled) {
    const trimmed = typeof code === 'string' ? code.trim() : '';
    if (!trimmed) throw Object.assign(new Error('Введите код двухфакторной аутентификации'), { status: 400 });
    const codeValid = /^\d{6}$/.test(trimmed)
      ? verifyTotp(row.totp_secret, trimmed)
      : await verifyAndConsumeBackupCode(userId, trimmed, db);
    if (!codeValid) throw Object.assign(new Error('Неверный код'), { status: 401 });
  }
}

module.exports = {
  sanitizeUser, getUserById, updateUser, searchUsers,
  toggleBlockUser, isBlocked,
  setContactAlias, deleteContactAlias, getContactAlias,
  updatePresenceStatus, clearExpiredPresenceStatuses,
  verifyAccountDeletionAuth,
  DELETED_ACCOUNT_USER_ID,
  DEFAULT_ACCENT_COLOR,
};
