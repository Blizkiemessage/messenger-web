/**
 * userService.js
 * ✅ Added: hide_avatar, avatar_exceptions fields.
 *    When hide_avatar=true, avatar_url is hidden from other users
 *    unless their ID is in avatar_exceptions JSON array.
 */
const { getDb } = require('../config/database');

function sanitizeUser(u, { showPrivate = false, viewerId = null } = {}) {
  if (!u) return null;

  // ✅ Hide avatar from others unless they're in exceptions
  let avatarUrl = u.avatar_url;
  if (!showPrivate && u.hide_avatar) {
    const exceptions = JSON.parse(u.avatar_exceptions || '[]');
    if (!viewerId || !exceptions.includes(viewerId)) {
      avatarUrl = null;
    }
  }

  return {
    id:           u.id,
    username:     u.username,
    display_name: u.display_name,
    avatar_url:   avatarUrl,
    last_seen_at: u.last_seen_at,
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
    has_password:      showPrivate ? !!u.password_hash : undefined,
  };
}

function getUserById(userId) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId) ?? null;
}

function updateUser(userId, {
  username, display_name, avatar_url, bio,
  birth_date, hide_bio, hide_birth_date, hide_email, no_group_add,
  hide_avatar, avatar_exceptions,
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

  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

function searchUsers(q, excludeId) {
  const like = `%${q.toLowerCase()}%`;
  return getDb()
    .prepare(
      `SELECT id, username, display_name, avatar_url, last_seen_at, no_group_add, hide_avatar, avatar_exceptions
       FROM users
       WHERE id != ? AND (LOWER(username) LIKE ? OR LOWER(display_name) LIKE ?)
       LIMIT 20`
    )
    .all([excludeId, like, like])
    .map(u => ({
      ...sanitizeUser(u, { viewerId: excludeId }),
      no_group_add: u.no_group_add ? true : false,
    }));
}

module.exports = { sanitizeUser, getUserById, updateUser, searchUsers };
