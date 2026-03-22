const { getDb } = require('../config/database');

function runMigrations() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      phone       TEXT UNIQUE,
      email       TEXT UNIQUE,
      username    TEXT UNIQUE,
      display_name TEXT NOT NULL DEFAULT '',
      avatar_url  TEXT,
      created_at  INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS otps (
      id          TEXT PRIMARY KEY,
      target      TEXT NOT NULL,
      code_hash   TEXT NOT NULL,
      expires_at  INTEGER NOT NULL,
      used        INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_otps_target ON otps(target);

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      revoked    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS chats (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL DEFAULT 'direct',
      name       TEXT,
      avatar_url TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_members (
      chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at  INTEGER NOT NULL,
      PRIMARY KEY (chat_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);

    CREATE TABLE IF NOT EXISTS messages (
      id          TEXT PRIMARY KEY,
      chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      sender_id   TEXT NOT NULL REFERENCES users(id),
      ciphertext  TEXT NOT NULL,
      iv          TEXT NOT NULL,
      auth_tag    TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      deleted_at  INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at   INTEGER NOT NULL,
      PRIMARY KEY (from_user_id, to_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_user_id, created_at);
    CREATE TABLE IF NOT EXISTS friends (
      user_a_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_b_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_a_id, user_b_id)
    );
    CREATE INDEX IF NOT EXISTS idx_friends_a ON friends(user_a_id);
    CREATE INDEX IF NOT EXISTS idx_friends_b ON friends(user_b_id);
  `);

  const alters = [
    'ALTER TABLE users ADD COLUMN push_token TEXT',
    'ALTER TABLE chat_members ADD COLUMN last_read_at INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE messages ADD COLUMN attachment_url TEXT',
    'ALTER TABLE messages ADD COLUMN attachment_type TEXT',
    'ALTER TABLE messages ADD COLUMN attachment_name TEXT',
    "ALTER TABLE messages ADD COLUMN liked_by TEXT NOT NULL DEFAULT '[]'",
    'ALTER TABLE chats ADD COLUMN creator_id TEXT',
    'ALTER TABLE chats ADD COLUMN avatar_url TEXT',
    'ALTER TABLE users ADD COLUMN password_hash TEXT',
    'ALTER TABLE chats ADD COLUMN description TEXT',
    'ALTER TABLE users ADD COLUMN bio TEXT',
    'ALTER TABLE users ADD COLUMN birth_date TEXT',
    'ALTER TABLE users ADD COLUMN hide_bio INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN hide_birth_date INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN no_group_add INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE messages ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE chats ADD COLUMN is_closed INTEGER NOT NULL DEFAULT 0',
    // ✅ NEW: file size in bytes for attachment messages
    'ALTER TABLE messages ADD COLUMN attachment_size INTEGER',
  ];

  for (const sql of alters) {
    try { db.exec(sql); } catch { /* column already exists */ }
  }

  // Assign legacy group creator
  try {
    const pashaId = db.prepare("SELECT id FROM users WHERE LOWER(username) LIKE 'pasha%' LIMIT 1").get()?.id;
    if (pashaId) {
      const info = db.prepare("UPDATE chats SET creator_id = ? WHERE type = 'group' AND creator_id IS NULL").run([pashaId]);
      if (info.changes > 0) console.log(`[DB] Assigned pasha as creator to ${info.changes} legacy groups.`);
    }
  } catch (err) {
    console.error('[DB] Failed to assign default creator:', err.message);
  }

  console.log('[DB] Migrations complete');
}

module.exports = { runMigrations };
