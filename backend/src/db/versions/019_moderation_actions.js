'use strict';

/**
 * 019_moderation_actions.js — full-fledged UGC report handling: investigate,
 * warn, ban.
 *
 * §2 of docs/STORE_LAUNCH_TZ.md shipped reporting (content_reports) but admin
 * could only dismiss — no way to actually act on a confirmed violation. Adds:
 *   - users.is_banned/ban_reason/banned_at — account-level suspension,
 *     checked at every login entry point (services/authService.js,
 *     routes/webauthn.js); existing sessions are revoked at ban time
 *     (services/moderationService.js), same mechanism already used for
 *     session revocation elsewhere (io.kickSession), so no new enforcement
 *     path is introduced.
 *   - user_warnings — a record of moderator warnings shown to the user
 *     in-app until acknowledged (routes/users.js: GET .../me/warnings,
 *     POST .../me/warnings/:id/acknowledge).
 */
function up(db) {
  const alters = [
    'ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN ban_reason TEXT',
    'ALTER TABLE users ADD COLUMN banned_at INTEGER',
  ];
  for (const sql of alters) {
    try { db.exec(sql); } catch { /* column already exists — idempotent */ }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_warnings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      admin_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      message TEXT NOT NULL,
      report_id TEXT REFERENCES content_reports(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      acknowledged_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_user_warnings_user ON user_warnings(user_id, acknowledged_at);
  `);
}

module.exports = { up };
