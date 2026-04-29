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
    // Fires when search_text is cleared (soft-delete): removes the stale FTS entry.
    // The existing fts_update trigger only handles WHEN new IS NOT NULL, so this covers the NULL case.
    `CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER UPDATE OF search_text ON messages WHEN old.search_text IS NOT NULL AND new.search_text IS NULL BEGIN INSERT INTO messages_fts(messages_fts, rowid, search_text) VALUES('delete', old.rowid, old.search_text); END`,
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
    // ✅ NEW: audio/video attachment duration (seconds) — avoids client-side re-decode on every load
    'ALTER TABLE messages ADD COLUMN attachment_duration REAL',
    // ✅ NEW: attachment meta (JSON string for stickers, GIF, custom emoji)
    'ALTER TABLE messages ADD COLUMN attachment_meta TEXT',
    // ✅ NEW: sticker packs (sticker and custom emoji packs)
    `CREATE TABLE IF NOT EXISTS sticker_packs (
      id TEXT PRIMARY KEY,
      owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      type TEXT NOT NULL CHECK (type IN ('sticker','emoji')),
      name TEXT NOT NULL,
      description TEXT,
      cover_url TEXT,
      is_public INTEGER NOT NULL DEFAULT 0,
      is_animated INTEGER NOT NULL DEFAULT 0,
      price INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sticker_packs_public ON sticker_packs(is_public, is_deleted)`,
    // ✅ NEW: items inside a sticker/emoji pack
    `CREATE TABLE IF NOT EXISTS sticker_pack_items (
      id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
      file_url TEXT NOT NULL,
      thumb_url TEXT,
      emoji_hint TEXT,
      keywords TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sticker_pack_items_pack ON sticker_pack_items(pack_id, sort_order)`,
    // ✅ NEW: packs installed by each user
    `CREATE TABLE IF NOT EXISTS user_sticker_packs (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pack_id TEXT NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
      installed_at INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, pack_id)
    )`,
    // ✅ NEW: user-created GIF
    `CREATE TABLE IF NOT EXISTS user_gifs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      file_url TEXT NOT NULL,
      thumb_url TEXT NOT NULL,
      title TEXT,
      keywords TEXT,
      is_public INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      width INTEGER,
      height INTEGER,
      duration_ms INTEGER,
      created_at INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_user_gifs_public ON user_gifs(is_public, is_deleted)`,
    `CREATE INDEX IF NOT EXISTS idx_user_gifs_owner ON user_gifs(owner_id)`,
    // ✅ NEW: content reports / complaints
    `CREATE TABLE IF NOT EXISTS content_reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      content_type TEXT NOT NULL CHECK (content_type IN ('sticker_pack','user_gif')),
      content_id TEXT NOT NULL,
      reason TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_content_reports_unresolved ON content_reports(resolved, created_at)`,
    // ✅ NEW: creation quota per user (free limits + purchased extras)
    `CREATE TABLE IF NOT EXISTS user_creation_quota (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      packs_created INTEGER NOT NULL DEFAULT 0,
      gifs_created INTEGER NOT NULL DEFAULT 0,
      free_packs_limit INTEGER NOT NULL DEFAULT 999,
      free_gifs_limit INTEGER NOT NULL DEFAULT 10,
      extra_packs INTEGER NOT NULL DEFAULT 0,
      extra_gifs INTEGER NOT NULL DEFAULT 0
    )`,
    // ✅ Unlimited packs for testing
    `UPDATE user_creation_quota SET free_packs_limit = 999 WHERE free_packs_limit <= 3`,
    // ✅ NEW: purchases of packs and quota slots
    `CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      type TEXT NOT NULL CHECK (type IN ('pack','quota_packs','quota_gifs')),
      pack_id TEXT REFERENCES sticker_packs(id) ON DELETE SET NULL,
      amount INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0
    )`,
    // ✅ NEW: original upload URL for sticker items — enables self-healing re-conversion
    // without asking users to re-upload (see POST /admin/api/sticker-repair).
    'ALTER TABLE sticker_pack_items ADD COLUMN orig_url TEXT',
    // ✅ SECURITY: store IP address at session creation for user visibility
    'ALTER TABLE sessions ADD COLUMN ip_address TEXT',
    // ✅ PERF: composite index for session lookups by user (logout-all, revoke, active-list)
    `CREATE INDEX IF NOT EXISTS idx_sessions_user_revoked ON sessions(user_id, revoked)`,
    // ✅ PERF: explicit named indexes on users (UNIQUE already creates implicit ones, but named for clarity)
    `CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email)`,
    `CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`,
    // ✅ PERF: composite index for OTP lookup by target+used (login / email verification)
    `CREATE INDEX IF NOT EXISTS idx_otps_target_used ON otps(target, used, expires_at)`,
    // ✅ PERF: index for messages by sender (admin delete user, push notifications)
    `CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id)`,
    // ✅ PERF: denormalized unread counter — avoids COUNT(*) on every getUserChats call
    'ALTER TABLE chat_members ADD COLUMN unread_count INTEGER NOT NULL DEFAULT 0',
    // ✅ ROLES: role in group chats — 'member' | 'moderator' | 'admin'
    "ALTER TABLE chat_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member'",
    // ✅ NEW: structured error log — stores background errors for admin panel review
    `CREATE TABLE IF NOT EXISTS app_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      tag TEXT,
      message TEXT,
      error_text TEXT,
      stack TEXT,
      meta TEXT,
      user_id TEXT,
      ts INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_app_errors_ts ON app_errors(ts)`,
    // ✅ NEW: admin audit log — records who did what and when in the admin panel
    `CREATE TABLE IF NOT EXISTS admin_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      target_meta TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log(created_at DESC)`,
    // ✅ E1: TOTP two-factor authentication
    'ALTER TABLE users ADD COLUMN totp_secret TEXT',
    'ALTER TABLE users ADD COLUMN totp_pending_secret TEXT',
    'ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN totp_backup_codes TEXT',
    // ✅ F3: presence intention status (free / busy / dnd)
    'ALTER TABLE users ADD COLUMN presence_status TEXT',
    'ALTER TABLE users ADD COLUMN presence_note TEXT',
    'ALTER TABLE users ADD COLUMN presence_expires_at INTEGER',
    // ✅ F1: time capsule / scheduled delivery
    // deliver_at  — Unix ms timestamp when the message should become visible
    // is_delivered — 0 = pending (hidden from chat), 1 = delivered (visible, default)
    'ALTER TABLE messages ADD COLUMN deliver_at INTEGER DEFAULT NULL',
    'ALTER TABLE messages ADD COLUMN is_delivered INTEGER NOT NULL DEFAULT 1',
    // Index lets the delivery job quickly find messages that are due
    `CREATE INDEX IF NOT EXISTS idx_messages_scheduled
       ON messages(deliver_at, is_delivered)
       WHERE deliver_at IS NOT NULL`,
    // ✅ E3: WebRTC call history
    `CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      caller_id TEXT NOT NULL REFERENCES users(id),
      callee_id TEXT NOT NULL REFERENCES users(id),
      call_type TEXT NOT NULL DEFAULT 'audio',
      status TEXT NOT NULL DEFAULT 'pending',
      started_at INTEGER,
      ended_at INTEGER,
      duration INTEGER,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_calls_chat ON calls(chat_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_calls_participants ON calls(caller_id, callee_id)`,
    // ✅ F4: shared notes per chat
    `CREATE TABLE IF NOT EXISTS chat_notes (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Заметка',
      content TEXT NOT NULL DEFAULT '',
      last_edited_by TEXT REFERENCES users(id),
      last_edited_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_chat_notes_chat ON chat_notes(chat_id, created_at DESC)`,
    // ✅ F4 v2: permissions — author, edit mode, visibility
    'ALTER TABLE chat_notes ADD COLUMN created_by TEXT REFERENCES users(id)',
    "ALTER TABLE chat_notes ADD COLUMN edit_mode TEXT NOT NULL DEFAULT 'all'",
    "ALTER TABLE chat_notes ADD COLUMN edit_exceptions TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE chat_notes ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'",
    "ALTER TABLE chat_notes ADD COLUMN visibility_exceptions TEXT NOT NULL DEFAULT '[]'",
    // ✅ F2: AI summary cache — drop+recreate to fix UNIQUE(chat_id,user_id) → (chat_id,user_id,period,format)
    // Safe because this is a pure cache table; data loss on restart is acceptable.
    `DROP TABLE IF EXISTS chat_summary_cache`,
    `CREATE TABLE IF NOT EXISTS chat_summary_cache (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      period TEXT NOT NULL DEFAULT 'all',
      format TEXT NOT NULL DEFAULT 'normal',
      summary TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      generated_at INTEGER NOT NULL,
      UNIQUE(chat_id, user_id, period, format)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_summary_cache_lookup ON chat_summary_cache(chat_id, user_id)`,
  ];

  for (const sql of alters) {
    try { db.exec(sql); } catch { /* already exists */ }
  }

  // Backfill: assign role='admin' to the creator of each existing group
  try {
    db.exec(`
      UPDATE chat_members SET role = 'admin'
      WHERE role = 'member'
        AND EXISTS (
          SELECT 1 FROM chats
          WHERE chats.id = chat_members.chat_id
            AND chats.type = 'group'
            AND chats.creator_id = chat_members.user_id
        )
    `);
    console.log('[DB] role backfill complete');
  } catch (e) { console.warn('[DB] role backfill:', e.message); }

  try {
    const members = db.prepare('SELECT chat_id, user_id, last_read_at FROM chat_members').all();
    const update = db.prepare('UPDATE chat_members SET unread_count = ? WHERE chat_id = ? AND user_id = ?');
    db.exec('BEGIN');
    try {
      for (const m of members) {
        const cnt = db.prepare(
          `SELECT COUNT(*) AS n FROM messages
           WHERE chat_id = ? AND sender_id != ? AND created_at > ? AND deleted_at IS NULL`
        ).get([m.chat_id, m.user_id, m.last_read_at ?? 0]).n;
        update.run([cnt, m.chat_id, m.user_id]);
      }
      db.exec('COMMIT');
      console.log('[DB] unread_count backfilled');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  } catch (err) { console.warn('[DB] unread_count backfill:', err.message); }

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
      let count = 0;
      db.exec('BEGIN');
      try {
        for (const row of rows) {
          try {
            const text = decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }).trim();
            if (text) { update.run([text, row.id]); count++; }
          } catch { /* skip undecryptable rows */ }
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      console.log(`[DB] Backfilled search_text for ${count} old messages`);
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

  // ── Partial indexes for the hottest queries ──────────────────────────────
  // These improve on the existing plain indexes by filtering out rows that are
  // never queried (deleted messages), making the index smaller and faster.
  const partialIndexes = [
    // Main chat-history query: "give me the last N non-deleted messages in this chat"
    // Replaces idx_messages_chat (no WHERE clause) with a smaller, more selective index.
    `CREATE INDEX IF NOT EXISTS idx_messages_chat_created
     ON messages(chat_id, created_at DESC) WHERE deleted_at IS NULL`,

    // Unread-count and message-list queries that exclude system messages.
    `CREATE INDEX IF NOT EXISTS idx_messages_unread
     ON messages(chat_id, created_at) WHERE deleted_at IS NULL AND is_system = 0`,
  ];

  for (const sql of partialIndexes) {
    try { db.exec(sql); } catch (e) { console.warn('[DB] index:', e.message); }
  }

  console.log('[DB] Migrations complete');
}

module.exports = { runMigrations };
