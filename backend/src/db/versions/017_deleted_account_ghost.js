'use strict';

/**
 * 017_deleted_account_ghost.js — permanent "Удалённый аккаунт" placeholder user.
 *
 * Account deletion (services/chat/teardown.js) used to hard-delete every trace
 * of the user, but `messages.sender_id` / `calls.caller_id`/`callee_id` /
 * `chat_notes.last_edited_by`/`created_by` reference users(id) WITHOUT a
 * cascade or set-null action — with PRAGMA foreign_keys=ON (always on, see
 * config/database.js) this made deletion fail outright for any account that
 * had ever made a call, left a note, or (still unhandled before this) sent a
 * message in a group chat it later left. Rather than deleting other people's
 * conversation history to route around the constraint, orphaned references
 * are reassigned to this single, permanent, login-less ghost account.
 */
function up(db) {
  db.prepare(`
    INSERT OR IGNORE INTO users
      (id, username, email, display_name, avatar_url, password_hash, created_at, last_seen_at)
    VALUES
      ('deleted-account', NULL, NULL, 'Удалённый аккаунт', NULL, NULL, 0, 0)
  `).run();
}

module.exports = { up };
