'use strict';

/**
 * 018_content_reports_message_user.js — жалобы на сообщения и пользователей.
 *
 * `content_reports.content_type` had a CHECK constraint limited to
 * ('sticker_pack','user_gif') (001_initial.js) — SQLite can't ALTER a CHECK
 * constraint in place, so the table is rebuilt with the same columns/FK/index
 * plus 'message' and 'user' in the allowed set. This is what lets
 * routes/messages.js and routes/users.js report endpoints reuse the existing
 * admin moderation queue (routes/admin/moderation.js already reads
 * content_reports generically, no sticker-pack-specific logic there).
 */
function up(db) {
  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='content_reports'"
  ).get();
  if (!table) return; // fresh DB — 001_initial.js will create it with the old CHECK, handled below

  db.exec(`
    CREATE TABLE content_reports_new (
      id TEXT PRIMARY KEY,
      reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      content_type TEXT NOT NULL CHECK (content_type IN ('sticker_pack','user_gif','message','user')),
      content_id TEXT NOT NULL,
      reason TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO content_reports_new (id, reporter_id, content_type, content_id, reason, resolved, created_at)
      SELECT id, reporter_id, content_type, content_id, reason, resolved, created_at FROM content_reports;
    DROP TABLE content_reports;
    ALTER TABLE content_reports_new RENAME TO content_reports;
    CREATE INDEX IF NOT EXISTS idx_content_reports_unresolved ON content_reports(resolved, created_at);
  `);
}

module.exports = { up };
