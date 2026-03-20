const { getDb } = require('../config/database');
const { sanitizeUser } = require('./userService');

function pairKey(a, b) {
  return a < b ? [a, b] : [b, a];
}

function areFriends(userId, otherUserId) {
  const [a, b] = pairKey(userId, otherUserId);
  const row = getDb()
    .prepare('SELECT 1 FROM friends WHERE user_a_id = ? AND user_b_id = ?')
    .get([a, b]);
  return !!row;
}

function createFriendRequest(fromUserId, toUserId) {
  if (!toUserId || fromUserId === toUserId) {
    throw Object.assign(new Error('Invalid userId'), { status: 400 });
  }

  const db = getDb();
  if (areFriends(fromUserId, toUserId)) {
    throw Object.assign(new Error('Already friends'), { status: 409 });
  }

  const existing = db
    .prepare('SELECT 1 FROM friend_requests WHERE from_user_id = ? AND to_user_id = ?')
    .get([fromUserId, toUserId]);
  if (existing) return { ok: true };

  const reverse = db
    .prepare('SELECT 1 FROM friend_requests WHERE from_user_id = ? AND to_user_id = ?')
    .get([toUserId, fromUserId]);
  if (reverse) {
    // If the other user already requested us, accept immediately.
    acceptFriendRequest(fromUserId, toUserId);
    return { ok: true, accepted: true };
  }

  db.prepare(
    'INSERT INTO friend_requests (from_user_id, to_user_id, created_at) VALUES (?, ?, ?)'
  ).run([fromUserId, toUserId, Date.now()]);

  return { ok: true };
}

function acceptFriendRequest(userId, fromUserId) {
  const db = getDb();
  const req = db
    .prepare('SELECT 1 FROM friend_requests WHERE from_user_id = ? AND to_user_id = ?')
    .get([fromUserId, userId]);
  if (!req) {
    throw Object.assign(new Error('Request not found'), { status: 404 });
  }

  const [a, b] = pairKey(userId, fromUserId);
  const now = Date.now();

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM friend_requests WHERE from_user_id = ? AND to_user_id = ?').run([
      fromUserId,
      userId,
    ]);
    db.prepare('INSERT OR IGNORE INTO friends (user_a_id, user_b_id, created_at) VALUES (?, ?, ?)').run([
      a,
      b,
      now,
    ]);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return { ok: true };
}

function cancelFriendRequest(fromUserId, toUserId) {
  getDb()
    .prepare('DELETE FROM friend_requests WHERE from_user_id = ? AND to_user_id = ?')
    .run([fromUserId, toUserId]);
  return { ok: true };
}

function removeFriend(userId, otherUserId) {
  const [a, b] = pairKey(userId, otherUserId);
  getDb().prepare('DELETE FROM friends WHERE user_a_id = ? AND user_b_id = ?').run([a, b]);
  return { ok: true };
}

function listFriends(userId) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT u.*
       FROM friends f
       JOIN users u ON u.id = CASE WHEN f.user_a_id = ? THEN f.user_b_id ELSE f.user_a_id END
       WHERE f.user_a_id = ? OR f.user_b_id = ?
       ORDER BY u.display_name ASC`
    )
    .all([userId, userId, userId]);
  return rows.map(sanitizeUser);
}

function listIncomingRequests(userId) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.last_seen_at, fr.created_at
       FROM friend_requests fr
       JOIN users u ON u.id = fr.from_user_id
       WHERE fr.to_user_id = ?
       ORDER BY fr.created_at DESC`
    )
    .all(userId);
  return rows.map((r) => ({
    user: sanitizeUser(r),
    created_at: r.created_at,
  }));
}

function getRelationshipStatuses(userId, otherIds) {
  const db = getDb();
  const unique = [...new Set(otherIds.filter(Boolean).filter((x) => x !== userId))];
  if (!unique.length) return {};

  const status = Object.fromEntries(unique.map((id) => [id, { isFriend: false, outgoing: false, incoming: false }]));

  // Friends
  const friendsRows = db
    .prepare(
      `SELECT user_a_id, user_b_id FROM friends
       WHERE user_a_id = ? OR user_b_id = ?`
    )
    .all([userId, userId]);
  for (const r of friendsRows) {
    const other = r.user_a_id === userId ? r.user_b_id : r.user_a_id;
    if (status[other]) status[other].isFriend = true;
  }

  // Outgoing requests
  const out = db
    .prepare(
      `SELECT to_user_id AS id FROM friend_requests
       WHERE from_user_id = ?`
    )
    .all(userId);
  for (const r of out) if (status[r.id]) status[r.id].outgoing = true;

  // Incoming requests
  const inc = db
    .prepare(
      `SELECT from_user_id AS id FROM friend_requests
       WHERE to_user_id = ?`
    )
    .all(userId);
  for (const r of inc) if (status[r.id]) status[r.id].incoming = true;

  return status;
}

module.exports = {
  createFriendRequest,
  acceptFriendRequest,
  cancelFriendRequest,
  removeFriend,
  listFriends,
  listIncomingRequests,
  getRelationshipStatuses,
};

