'use strict';

/**
 * workers/s3Cleanup.js — Persistent S3 delete retry worker.
 *
 * ── What it does ─────────────────────────────────────────────────────────────
 *   Runs every 5 minutes and processes up to 50 rows from s3_delete_queue
 *   where deleted_at IS NULL AND attempts < MAX_ATTEMPTS.
 *   For each row it issues a single DeleteObjectCommand to S3.
 *   On success  → sets deleted_at = now().
 *   On failure  → increments attempts, stores last_error.
 *   After MAX_ATTEMPTS failures → logs at error level (visible in admin panel).
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *   s3Delete.js retries up to 3 times in-process with exponential backoff.
 *   If all 3 attempts fail (e.g. transient outage lasting > 4 s) the key is
 *   enqueued here so the next cleanup cycle picks it up — no orphaned objects.
 *
 * ── Startup behaviour ────────────────────────────────────────────────────────
 *   On first start the worker processes any queue items left over from the
 *   previous server run (e.g. a crash during an outage).
 */

const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getDb }  = require('../config/database');
const logger     = require('../utils/logger');

const MAX_ATTEMPTS = 10;   // give up after 10 cross-run retries
const BATCH_SIZE   = 50;
const INTERVAL_MS  = 5 * 60 * 1000; // 5 minutes

const useS3 = !!(
  process.env.S3_ACCESS_KEY_ID &&
  process.env.S3_SECRET_ACCESS_KEY &&
  process.env.S3_BUCKET
);

let s3Client;
if (useS3) {
  s3Client = new S3Client({
    region:   process.env.S3_REGION   || 'ru-central1',
    endpoint: process.env.S3_ENDPOINT || 'https://storage.yandexcloud.net',
    credentials: {
      accessKeyId:     process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });
}

// ── Core queue processor ──────────────────────────────────────────────────────

async function processQueue() {
  if (!useS3) return;

  const db = getDb();
  const items = db.prepare(`
    SELECT id, s3_key, attempts
    FROM   s3_delete_queue
    WHERE  deleted_at IS NULL AND attempts < ?
    ORDER  BY created_at ASC
    LIMIT  ?
  `).all(MAX_ATTEMPTS, BATCH_SIZE);

  if (items.length === 0) return;

  logger.info('[S3Cleanup]', `Processing ${items.length} pending delete(s) from queue`, { count: items.length });

  const markDone  = db.prepare('UPDATE s3_delete_queue SET deleted_at = ?          WHERE id = ?');
  const markFailed = db.prepare('UPDATE s3_delete_queue SET attempts = ?, last_error = ? WHERE id = ?');

  for (const item of items) {
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key:    item.s3_key,
      }));
      markDone.run(Date.now(), item.id);
      logger.info('[S3Cleanup]', `Queued delete succeeded: ${item.s3_key}`, { key: item.s3_key });
    } catch (err) {
      const next = item.attempts + 1;
      markFailed.run(next, err.message, item.id);

      if (next >= MAX_ATTEMPTS) {
        logger.error(
          '[S3Cleanup]',
          `Permanent S3 delete failure after ${MAX_ATTEMPTS} attempts — object may be orphaned`,
          err,
          { key: item.s3_key },
        );
      } else {
        logger.warn('[S3Cleanup]', `Delete attempt ${next}/${MAX_ATTEMPTS} failed — will retry`, {
          key:   item.s3_key,
          error: err.message,
        });
      }
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Enqueues an S3 key for deferred deletion.
 * Called by s3Delete.js when all in-flight retries are exhausted.
 * Never throws — queue failure is non-fatal.
 */
function enqueueDelete(key) {
  try {
    const db = require('../config/database').getDb();
    db.prepare('INSERT INTO s3_delete_queue (s3_key) VALUES (?)').run(key);
  } catch (err) {
    logger.warn('[S3Cleanup]', 'Failed to enqueue key for deferred delete', { key, error: err.message });
  }
}

/**
 * Starts the recurring cleanup worker.
 * Processes any leftover queue items immediately on startup, then every 5 minutes.
 * Safe to call once at server startup.
 */
function startS3CleanupWorker() {
  if (!useS3) {
    logger.warn('[S3Cleanup]', 'S3 not configured — cleanup worker disabled', {});
    return;
  }

  // Drain anything left from a previous server run
  processQueue().catch(err =>
    logger.error('[S3Cleanup]', 'Startup queue processing failed', err, {})
  );

  const timer = setInterval(() => {
    processQueue().catch(err =>
      logger.error('[S3Cleanup]', 'Periodic queue processing failed', err, {})
    );
  }, INTERVAL_MS);
  timer.unref(); // don't prevent graceful shutdown

  logger.info('[S3Cleanup]', 'S3 cleanup worker started (every 5 min)', {});
}

module.exports = { startS3CleanupWorker, enqueueDelete, processQueue };
