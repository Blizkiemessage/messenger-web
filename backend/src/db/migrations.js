const { getDb } = require('../config/database');

function runMigrations() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, phone TEXT UNIQUE, email TEXT UNIQUE,
      username TEXT UNIQUE, display_name TEXT NOT NULL DEFAULT '',
      avatar_url TEXT, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS otps (
      id TEXT PRIMARY KEY, target TEXT NOT NULL, code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_otps_target ON otps(target);
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'direct',
      name TEXT, avatar_url TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_members (
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at INTEGER NOT NULL, PRIMARY KEY (chat_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id),
      ciphertext TEXT NOT NULL, iv TEXT NOT NULL, auth_tag TEXT NOT NULL,
      created_at INTEGER NOT NULL, deleted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS support_reports (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      username TEXT NOT NULL,
      user_email TEXT,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      has_image INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_support_reports_created ON support_reports(created_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS polls (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      question TEXT NOT NULL,
      options TEXT NOT NULL,
      allow_multiple INTEGER NOT NULL DEFAULT 0,
      is_anonymous INTEGER NOT NULL DEFAULT 1,
      is_quiz INTEGER NOT NULL DEFAULT 0,
      correct_option_id TEXT,
      closed_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS poll_votes (
      poll_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      option_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (poll_id, user_id, option_id)
    );
    CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes(poll_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL, PRIMARY KEY (from_user_id, to_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_user_id, created_at);
    CREATE TABLE IF NOT EXISTS friends (
      user_a_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_b_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL, PRIMARY KEY (user_a_id, user_b_id)
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
    'ALTER TABLE users ADD COLUMN hide_avatar INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE users ADD COLUMN avatar_exceptions TEXT NOT NULL DEFAULT '[]'",
    'ALTER TABLE messages ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE chats ADD COLUMN is_closed INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE messages ADD COLUMN attachment_size INTEGER',
    // ✅ NEW: pinned message per chat
    'ALTER TABLE messages ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0',
    // ✅ NEW: forwarded message attribution
    'ALTER TABLE messages ADD COLUMN forwarded_from_user_id TEXT',
    'ALTER TABLE messages ADD COLUMN forwarded_from_username TEXT',
    // ✅ NEW: pending registration data for email OTP verification
    'ALTER TABLE otps ADD COLUMN meta TEXT',
    // ✅ NEW: email privacy toggle
    'ALTER TABLE users ADD COLUMN hide_email INTEGER NOT NULL DEFAULT 0',
    // ✅ SECURITY: track failed OTP attempts to prevent brute-force
    'ALTER TABLE otps ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0',
    // ✅ NEW: reply/quote columns
    'ALTER TABLE messages ADD COLUMN reply_to_id TEXT',
    'ALTER TABLE messages ADD COLUMN reply_to_sender_id TEXT',
    'ALTER TABLE messages ADD COLUMN reply_to_sender_username TEXT',
    'ALTER TABLE messages ADD COLUMN reply_to_ciphertext TEXT',
    'ALTER TABLE messages ADD COLUMN reply_to_iv TEXT',
    'ALTER TABLE messages ADD COLUMN reply_to_auth_tag TEXT',
    // ✅ NEW: emoji reactions (array of { userId, emoji })
    "ALTER TABLE messages ADD COLUMN reactions TEXT NOT NULL DEFAULT '[]'",
    // ✅ NEW: hide last seen time from other users
    'ALTER TABLE users ADD COLUMN hide_last_seen INTEGER NOT NULL DEFAULT 0',
    // ✅ NEW: appearance settings — synced across devices
    "ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'dark'",
    "ALTER TABLE users ADD COLUMN accent_color TEXT NOT NULL DEFAULT '#2f81f7'",
    // ✅ NEW: polls
    'ALTER TABLE messages ADD COLUMN poll_id TEXT',
    // ✅ NEW: plaintext search index for messages (encrypted text is not searchable)
    'ALTER TABLE messages ADD COLUMN search_text TEXT',
    // ✅ NEW: push subscriptions table
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    // ✅ NEW: per-user chat pin & mute (stored in chat_members)
    'ALTER TABLE chat_members ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE chat_members ADD COLUMN pin_order INTEGER',
    'ALTER TABLE chat_members ADD COLUMN is_muted INTEGER NOT NULL DEFAULT 0',
    // ✅ NEW: message editing
    'ALTER TABLE messages ADD COLUMN edited_at INTEGER',
    // ✅ NEW: session device tracking
    'ALTER TABLE sessions ADD COLUMN user_agent TEXT',
    'ALTER TABLE sessions ADD COLUMN last_used_at INTEGER',
    // ✅ NEW: cached link previews (24h TTL, keyed by URL)
    `CREATE TABLE IF NOT EXISTS link_previews (
      url TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      image TEXT,
      fetched_at INTEGER NOT NULL
    )`,
    // ✅ NEW: FTS5 virtual table for fast full-text search (replaces LIKE)
    `CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(search_text, content=messages, content_rowid=rowid)`,
    `CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages WHEN new.search_text IS NOT NULL BEGIN INSERT INTO messages_fts(rowid, search_text) VALUES (new.rowid, new.search_text); END`,
    `CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF search_text ON messages WHEN new.search_text IS NOT NULL BEGIN INSERT INTO messages_fts(messages_fts, rowid, search_text) VALUES('delete', old.rowid, old.search_text); INSERT INTO messages_fts(rowid, search_text) VALUES(new.rowid, new.search_text); END`,
    // ✅ NEW: blocked users list
    `CREATE TABLE IF NOT EXISTS blocked_users (
      blocker_id TEXT NOT NULL,
      blocked_id TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (blocker_id, blocked_id)
    )`,
    // ✅ NEW: per-viewer contact alias (nickname override)
    `CREATE TABLE IF NOT EXISTS contact_aliases (
      user_id   TEXT NOT NULL,
      target_id TEXT NOT NULL,
      alias     TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, target_id)
    )`,
    // ✅ NEW: per-user message hide ("delete for me")
    `CREATE TABLE IF NOT EXISTS message_hidden (
      user_id    TEXT NOT NULL,
      message_id TEXT NOT NULL,
      PRIMARY KEY (user_id, message_id)
    )`,
  ];

  for (const sql of alters) {
    try { db.exec(sql); } catch { /* already exists */ }
  }

  try {
    const pashaId = db.prepare("SELECT id FROM users WHERE LOWER(username) LIKE 'pasha%' LIMIT 1").get()?.id;
    if (pashaId) {
      const info = db.prepare("UPDATE chats SET creator_id = ? WHERE type = 'group' AND creator_id IS NULL").run([pashaId]);
      if (info.changes > 0) console.log(`[DB] Assigned pasha as creator to ${info.changes} legacy groups.`);
    }
  } catch (err) { console.error('[DB] Failed to assign default creator:', err.message); }

  // Backfill search_text for old messages that were encrypted before this column existed
  try {
    const { decrypt } = require('../crypto/aes');
    const rows = db.prepare(
      `SELECT id, ciphertext, iv, auth_tag FROM messages WHERE search_text IS NULL AND is_system = 0 AND deleted_at IS NULL`
    ).all();
    if (rows.length > 0) {
      const update = db.prepare(`UPDATE messages SET search_text = ? WHERE id = ?`);
      const backfill = db.transaction(() => {
        let count = 0;
        for (const row of rows) {
          try {
            const text = decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }).trim();
            if (text) { update.run([text, row.id]); count++; }
          } catch { /* skip undecryptable rows */ }
        }
        return count;
      });
      const filled = backfill();
      console.log(`[DB] Backfilled search_text for ${filled} old messages`);
    }
  } catch (err) { console.error('[DB] search_text backfill failed:', err.message); }

  // Populate FTS5 index if empty (first run, or after a rebuild)
  try {
    const ftsCount = db.prepare('SELECT COUNT(*) AS n FROM messages_fts').get().n;
    if (ftsCount === 0) {
      db.exec(`
        INSERT INTO messages_fts(rowid, search_text)
        SELECT rowid, search_text FROM messages
        WHERE search_text IS NOT NULL AND deleted_at IS NULL AND is_system = 0
      `);
      const n = db.prepare('SELECT COUNT(*) AS n FROM messages_fts').get().n;
      if (n > 0) console.log(`[DB] FTS5 index populated with ${n} messages`);
    }
  } catch (err) { console.error('[DB] FTS5 backfill failed:', err.message); }

  console.log('[DB] Migrations complete');
}

module.exports = { runMigrations };
