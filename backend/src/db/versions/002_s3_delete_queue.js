'use strict';

/**
 * 002_s3_delete_queue.js
 *
 * Persistent retry queue for S3 object deletions that failed all in-flight attempts.
 * The s3Cleanup worker processes this table every 5 minutes and retries until the
 * object is gone or the attempt cap is reached (logged as a permanent error at that
 * point so it surfaces in the admin error log).
 *
 * Schema intent:
 *   - s3_key      — the S3 object key (e.g. "abc123.webp" or "db-backups/...")
 *   - attempts    — how many times s3Cleanup has tried to delete this key
 *   - last_error  — the last AWS error message (for diagnostics)
 *   - created_at  — when the failed delete was first enqueued
 *   - deleted_at  — set to a timestamp when the deletion finally succeeds; NULL = pending
 */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS s3_delete_queue (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      s3_key      TEXT    NOT NULL,
      attempts    INTEGER NOT NULL DEFAULT 0,
      last_error  TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      deleted_at  INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_s3_delete_queue_pending
      ON s3_delete_queue(attempts, created_at)
      WHERE deleted_at IS NULL;
  `);
}

module.exports = { up };
