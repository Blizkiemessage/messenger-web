'use strict';

/**
 * workers/deletedAccountCleanup.js — retention cleanup for the "Удалённый
 * аккаунт" ghost user's accumulated content.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *   services/chat/teardown.js reassigns messages/calls that belonged to a
 *   deleted account onto a single permanent placeholder user
 *   (userService.DELETED_ACCOUNT_USER_ID) instead of deleting them, so other
 *   participants keep their conversation history intact. Left unchecked that
 *   placeholder's content would grow forever as more accounts get deleted —
 *   this worker prunes anything old enough that the retention window has
 *   passed, so storage doesn't grow unbounded and stale ghost-attributed
 *   content doesn't linger indefinitely.
 *
 *   Chat notes are NOT pruned here — they're reference material for the
 *   chat (not a disposable message stream) and low-volume, so ghost
 *   attribution on a note is kept permanently.
 *
 * ── Schedule ─────────────────────────────────────────────────────────────────
 *   Runs once on startup (catches anything missed while the process was
 *   down), then once every 24 h.
 */
const { getDb } = require('../config/database');
const { DELETED_ACCOUNT_USER_ID } = require('../services/userService');
const logger = require('../utils/logger');

const DEFAULT_RETENTION_DAYS = 180;
const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

function retentionMs() {
  const days = Number(process.env.DELETED_ACCOUNT_RETENTION_DAYS) || DEFAULT_RETENTION_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

/** Runs one cleanup pass. Exported for tests/manual invocation. */
function runCleanup() {
  const db = getDb();
  const cutoff = Date.now() - retentionMs();

  const messagesResult = db
    .prepare('DELETE FROM messages WHERE sender_id = ? AND created_at < ?')
    .run(DELETED_ACCOUNT_USER_ID, cutoff);

  const callsResult = db
    .prepare('DELETE FROM calls WHERE (caller_id = ? OR callee_id = ?) AND created_at < ?')
    .run(DELETED_ACCOUNT_USER_ID, DELETED_ACCOUNT_USER_ID, cutoff);

  if (messagesResult.changes || callsResult.changes) {
    logger.info('[DeletedAccountCleanup]', 'Pruned ghost-attributed content past retention', {
      messagesDeleted: messagesResult.changes,
      callsDeleted: callsResult.changes,
      cutoff,
    });
  }

  return { messagesDeleted: messagesResult.changes, callsDeleted: callsResult.changes };
}

/**
 * Starts the recurring retention cleanup worker.
 * Safe to call once at server startup.
 */
function startDeletedAccountCleanupWorker() {
  try {
    runCleanup();
  } catch (err) {
    logger.error('[DeletedAccountCleanup]', 'Startup cleanup pass failed', err, {});
  }

  const timer = setInterval(() => {
    try {
      runCleanup();
    } catch (err) {
      logger.error('[DeletedAccountCleanup]', 'Periodic cleanup pass failed', err, {});
    }
  }, INTERVAL_MS);
  timer.unref(); // don't prevent graceful shutdown

  logger.info('[DeletedAccountCleanup]', `Retention cleanup worker started (every 24h, retention ${retentionMs() / 86400000}d)`, {});
}

module.exports = { startDeletedAccountCleanupWorker, runCleanup };
