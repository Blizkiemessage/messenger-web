/**
 * userService.js
 *
 * All user-related database operations:
 *   - sanitizeUser     — strip private fields before sending to clients
 *   - getUserById      — fetch a single user row
 *   - updateUser       — patch profile fields
 *   - searchUsers      — username/display_name search
 *
 * No dependencies on other services (safe to import from anywhere).
 */

const { getDb } = require('../config/database');

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Strip raw DB row down to what clients are allowed to see.
 *
 * @param {object}  u                  Raw user row from DB
 * @param {object}  [opts]
 * @param {boolean} [opts.showPrivate] When true, include private flags
 *                                     (hide_bio, hide_birth_date, no_group_add, has_password)
 */
function sanitizeUser(u, { showPrivate = false } = {}) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    avatar_url: u.avatar_url,
    last_seen_at: u.last_seen_at,
    bio: (showPrivate || !u.hide_bio) ? (u.bio || null) : null,
    birth_date: (showPrivate || !u.hide_birth_date) ? (u.birth_date || null) : null,
    // Private flags — only sent back to the user themselves
    hide_bio: showPrivate ? (u.hide_bio ? true : false) : undefined,
    hide_birth_date: showPrivate ? (u.hide_birth_date ? true : false) : undefined,
    no_group_add: showPrivate ? (u.no_group_add ? true : false) : undefined,
    has_password: showPrivate ? !!u.password_hash : undefined,
  };
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch a raw user row by ID.
 * Returns null when not found.
 */
function getUserById(userId) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId) ?? null;
}

/**
 * Patch one or more profile fields for a user.
 * Only the fields that are explicitly passed will be updated.
 *
 * @returns {object} Updated raw user row
 */
function updateUser(userId, {
  username, display_name, avatar_url, bio,
  birth_date, hide_bio, hide_birth_date, no_group_add,
}) {
  const db = getDb();

  if (username !== undefined && username !== null) {
    const clean = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,32}$/.test(clean)) {
      throw Object.assign(new Error('Invalid username'), { status: 400 });
    }
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run([clean, userId]);
  }
  if (display_name !== undefined)
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run([display_name, userId]);
  if (avatar_url !== undefined)
    db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run([avatar_url, userId]);
  if (bio !== undefined)
    db.prepare('UPDATE users SET bio = ? WHERE id = ?').run([bio, userId]);
  if (birth_date !== undefined)
    db.prepare('UPDATE users SET birth_date = ? WHERE id = ?').run([birth_date, userId]);
  if (hide_bio !== undefined)
    db.prepare('UPDATE users SET hide_bio = ? WHERE id = ?').run([hide_bio ? 1 : 0, userId]);
  if (hide_birth_date !== undefined)
    db.prepare('UPDATE users SET hide_birth_date = ? WHERE id = ?').run([hide_birth_date ? 1 : 0, userId]);
  if (no_group_add !== undefined)
    db.prepare('UPDATE users SET no_group_add = ? WHERE id = ?').run([no_group_add ? 1 : 0, userId]);

  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

/**
 * Search users by username or display_name (case-insensitive, max 20 results).
 * Excludes the requesting user from results.
 * Also returns the no_group_add flag so the UI can show a lock icon.
 */
function searchUsers(q, excludeId) {
  const like = `%${q.toLowerCase()}%`;
  return getDb()
    .prepare(
      `SELECT id, username, display_name, avatar_url, last_seen_at, no_group_add
       FROM users
       WHERE id != ? AND (LOWER(username) LIKE ? OR LOWER(display_name) LIKE ?)
       LIMIT 20`
    )
    .all([excludeId, like, like])
    .map(u => ({ ...sanitizeUser(u), no_group_add: u.no_group_add ? true : false }));
}

module.exports = { sanitizeUser, getUserById, updateUser, searchUsers };
