'use strict';

/**
 * workers/dbBackup.js — Automated daily SQLite backup to Yandex Cloud S3.
 *
 * ── What it does ─────────────────────────────────────────────────────────────
 *   1. Every day at 03:00 UTC creates a hot backup of the SQLite database
 *      using the built-in better-sqlite3 Online Backup API (non-blocking —
 *      reads and writes continue normally during backup).
 *   2. Uploads the backup file to S3 as:
 *        <DB_BACKUP_S3_PREFIX>blizkie-YYYY-MM-DD.db
 *      (prefix defaults to "db-backups/")
 *   3. Deletes backups older than DB_BACKUP_KEEP_DAYS (default: 30) days.
 *
 * ── Env vars ─────────────────────────────────────────────────────────────────
 *   Required (same as media S3, already set in Amvera):
 *     S3_ACCESS_KEY_ID       — Yandex Cloud service account key ID
 *     S3_SECRET_ACCESS_KEY   — Yandex Cloud service account secret
 *     S3_BUCKET              — bucket name (same bucket as media uploads)
 *
 *   Optional (have sensible defaults):
 *     S3_REGION              — default: ru-central1
 *     S3_ENDPOINT            — default: https://storage.yandexcloud.net
 *     DB_BACKUP_S3_PREFIX    — S3 key prefix for backups, default: db-backups/
 *     DB_BACKUP_KEEP_DAYS    — how many days to keep, default: 30
 *     DB_BACKUP_HOUR_UTC     — hour of day (UTC) to run backup, default: 3
 *
 * ── Manual trigger ───────────────────────────────────────────────────────────
 *   Call runBackup() directly from the admin panel or CLI.
 *   The worker exports { startDbBackupWorker, runBackup }.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require('@aws-sdk/client-s3');

const { getDb }  = require('../config/database');
const logger     = require('../utils/logger');
const { encryptBackup } = require('../utils/backupCrypto');

// ── Config ───────────────────────────────────────────────────────────────────

const BACKUP_PREFIX    = (process.env.DB_BACKUP_S3_PREFIX    || 'db-backups/').replace(/\/?$/, '/');
const BACKUP_KEEP_DAYS = parseInt(process.env.DB_BACKUP_KEEP_DAYS   || '30',  10);
const BACKUP_HOUR_UTC  = parseInt(process.env.DB_BACKUP_HOUR_UTC    || '3',   10);

// Backups may live in a separate bucket with separate (ideally write-only)
// credentials so a compromise of the media-serving keys can't read DB backups.
// Falls back to the media bucket/keys when the dedicated vars aren't set.
const BACKUP_BUCKET = process.env.DB_BACKUP_S3_BUCKET || process.env.S3_BUCKET;
const BACKUP_ACCESS_KEY_ID     = process.env.DB_BACKUP_S3_ACCESS_KEY_ID     || process.env.S3_ACCESS_KEY_ID;
const BACKUP_SECRET_ACCESS_KEY = process.env.DB_BACKUP_S3_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY;
const usingDedicatedBackupCreds = !!(
  process.env.DB_BACKUP_S3_ACCESS_KEY_ID && process.env.DB_BACKUP_S3_SECRET_ACCESS_KEY
);

const useS3 = !!(BACKUP_ACCESS_KEY_ID && BACKUP_SECRET_ACCESS_KEY && BACKUP_BUCKET);

let s3Client;
if (useS3) {
  s3Client = new S3Client({
    region:   process.env.DB_BACKUP_S3_REGION   || process.env.S3_REGION   || 'ru-central1',
    endpoint: process.env.DB_BACKUP_S3_ENDPOINT || process.env.S3_ENDPOINT || 'https://storage.yandexcloud.net',
    credentials: {
      accessKeyId:     BACKUP_ACCESS_KEY_ID,
      secretAccessKey: BACKUP_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true, // required for Yandex Cloud S3
  });
}

// ── Backup logic ─────────────────────────────────────────────────────────────

/**
 * Runs one full backup cycle:
 *   1. Hot-copy the DB to a temp file via better-sqlite3 Online Backup API.
 *   2. Stream-upload the temp file to S3.
 *   3. Prune backups older than BACKUP_KEEP_DAYS.
 *   4. Delete the temp file.
 *
 * Safe to call at any time — does not block the event loop.
 * Returns { ok: true, key, sizeMb } on success, { ok: false, error } on failure.
 */
async function runBackup() {
  if (!useS3) {
    const msg = 'S3 credentials not set — backup skipped (set S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET)';
    logger.warn('[DBBackup]', msg, {});
    return { ok: false, error: msg };
  }

  const db      = getDb();
  const date    = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  // ".db.enc" — the object is AES-256-GCM encrypted (see backupCrypto); restore
  // with scripts/restore-backup.js. Never a plaintext .db on remote storage.
  const key     = `${BACKUP_PREFIX}blizkie-${date}.db.enc`;
  const tmpPath = path.join(os.tmpdir(), `blizkie-db-backup-${Date.now()}.db`);

  logger.info('[DBBackup]', `Starting backup → s3://${BACKUP_BUCKET}/${key}`, {});

  try {
    // ── Step 1: hot copy via SQLite Online Backup API ─────────────────────
    // better-sqlite3's .backup() uses the C-level sqlite3_backup_* API.
    // It copies page-by-page so concurrent reads and writes work normally.
    await db.backup(tmpPath);

    // ── Step 2: encrypt the dump before it leaves the process ─────────────
    // Read the temp dump fully and encrypt in memory. The DB holds messages +
    // metadata only (media is in S3), so it stays small enough for this; switch
    // to a streaming cipher if the dump ever outgrows available memory.
    const plain     = fs.readFileSync(tmpPath);
    const encrypted = encryptBackup(plain);

    // ── Step 3: upload the encrypted blob ────────────────────────────────
    await s3Client.send(new PutObjectCommand({
      Bucket:        BACKUP_BUCKET,
      Key:           key,
      Body:          encrypted,
      ContentLength: encrypted.length,
      ContentType:   'application/octet-stream',
      // Tag backups so lifecycle rules can target them independently
      Tagging:       'type=db-backup',
    }));

    const sizeMb = (encrypted.length / 1_048_576).toFixed(2);
    logger.info('[DBBackup]', `Backup complete (encrypted): ${key} (${sizeMb} MB)`, { key, sizeMb });

    // ── Step 3: prune old backups ─────────────────────────────────────────
    await pruneOldBackups();

    return { ok: true, key, sizeMb };

  } catch (err) {
    logger.error('[DBBackup]', 'Backup failed', err, { key });
    return { ok: false, error: err.message };

  } finally {
    // ── Step 4: clean up temp file ────────────────────────────────────────
    try { fs.unlinkSync(tmpPath); } catch { /* already gone */ }
  }
}

/**
 * Lists all objects under BACKUP_PREFIX and deletes those whose
 * LastModified date is older than BACKUP_KEEP_DAYS days.
 */
async function pruneOldBackups() {
  const cutoffMs = Date.now() - BACKUP_KEEP_DAYS * 86_400_000;

  try {
    const list = await s3Client.send(new ListObjectsV2Command({
      Bucket: BACKUP_BUCKET,
      Prefix: BACKUP_PREFIX,
    }));

    const toDelete = (list.Contents || [])
      .filter(obj => new Date(obj.LastModified).getTime() < cutoffMs)
      .map(obj => ({ Key: obj.Key }));

    if (toDelete.length === 0) {
      logger.info('[DBBackup]', 'No old backups to prune', {});
      return;
    }

    await s3Client.send(new DeleteObjectsCommand({
      Bucket: BACKUP_BUCKET,
      Delete: { Objects: toDelete, Quiet: true },
    }));

    logger.info('[DBBackup]', `Pruned ${toDelete.length} backup(s) older than ${BACKUP_KEEP_DAYS} days`, {
      pruned: toDelete.map(o => o.Key),
    });

  } catch (err) {
    // Pruning failure is non-fatal — next backup will try again
    logger.warn('[DBBackup]', 'Failed to prune old backups', { error: err.message });
  }
}

// ── Scheduler ────────────────────────────────────────────────────────────────

/**
 * Calculates milliseconds until the next BACKUP_HOUR_UTC:00:00 UTC.
 * If that moment is in the past today, schedules for tomorrow.
 */
function msUntilNextBackup() {
  const now  = new Date();
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    BACKUP_HOUR_UTC, 0, 0, 0,
  ));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next - now;
}

/**
 * Starts the recurring daily backup worker.
 * Schedules the first run at BACKUP_HOUR_UTC:00 UTC, then every 24 h.
 *
 * If S3 is not configured, logs a warning and returns immediately.
 * Safe to call multiple times — but should only be called once at startup.
 */
function startDbBackupWorker() {
  if (!useS3) {
    logger.warn(
      '[DBBackup]',
      'DB backup disabled: S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / S3_BUCKET not set. ' +
      'Add these env vars in Amvera to enable automated backups.',
      {},
    );
    return;
  }

  function scheduleNext() {
    const delay      = msUntilNextBackup();
    const nextDateMs = Date.now() + delay;
    const nextIso    = new Date(nextDateMs).toISOString();
    const hoursLeft  = Math.round(delay / 3_600_000 * 10) / 10;

    logger.info('[DBBackup]', `Next backup at ${nextIso} (in ${hoursLeft}h)`, {});

    setTimeout(async () => {
      await runBackup();
      scheduleNext(); // arm the next day's run
    }, delay).unref(); // .unref() so the timer doesn't prevent process exit
  }

  scheduleNext();
  logger.info(
    '[DBBackup]',
    `Backup worker started — daily at ${BACKUP_HOUR_UTC.toString().padStart(2, '0')}:00 UTC, ` +
    `keeping last ${BACKUP_KEEP_DAYS} days, encrypted, prefix: s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}` +
    `${usingDedicatedBackupCreds ? ' (dedicated backup credentials)' : ''}`,
    {},
  );
}

module.exports = { startDbBackupWorker, runBackup };
