#!/usr/bin/env node
/**
 * restore-backup.js — download &/or decrypt a Blizkie DB backup.
 *
 * Backups produced by workers/dbBackup.js are AES-256-GCM encrypted
 * (see utils/backupCrypto.js). This tool turns one back into a usable .db file.
 *
 * Usage:
 *   # Decrypt a local encrypted backup file:
 *   node scripts/restore-backup.js ./blizkie-2026-06-18.db.enc [out.db]
 *
 *   # Download an object from the backup bucket by key, then decrypt:
 *   node scripts/restore-backup.js --s3 db-backups/blizkie-2026-06-18.db.enc [out.db]
 *
 *   # List available backups in the bucket:
 *   node scripts/restore-backup.js --list
 *
 * Requires the SAME key the backup was made with:
 *   DB_BACKUP_ENCRYPTION_KEY  (if it was set when the backup ran), otherwise
 *   MESSAGE_ENCRYPTION_KEY    (the key is HKDF-derived from it).
 *
 * Legacy plaintext ".db" backups (made before encryption was added) are detected
 * by the missing magic header and copied through unchanged, with a warning.
 */

'use strict';

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { decryptBackup, isEncryptedBackup } = require('../src/utils/backupCrypto');

const PREFIX = (process.env.DB_BACKUP_S3_PREFIX || 'db-backups/').replace(/\/?$/, '/');
const BUCKET = process.env.DB_BACKUP_S3_BUCKET || process.env.S3_BUCKET;

function makeS3() {
  const { S3Client } = require('@aws-sdk/client-s3');
  const accessKeyId     = process.env.DB_BACKUP_S3_ACCESS_KEY_ID     || process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.DB_BACKUP_S3_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey || !BUCKET) {
    throw new Error('S3 not configured (need backup or media S3_* env vars + bucket)');
  }
  return new S3Client({
    region:   process.env.DB_BACKUP_S3_REGION   || process.env.S3_REGION   || 'ru-central1',
    endpoint: process.env.DB_BACKUP_S3_ENDPOINT || process.env.S3_ENDPOINT || 'https://storage.yandexcloud.net',
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

async function listBackups() {
  const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
  const s3 = makeS3();
  const out = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX }));
  const items = (out.Contents || []).sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
  if (!items.length) { console.log('No backups found under', `s3://${BUCKET}/${PREFIX}`); return; }
  console.log(`Backups in s3://${BUCKET}/${PREFIX}:`);
  for (const o of items) {
    console.log(`  ${o.Key}  (${(o.Size / 1024).toFixed(0)} KB, ${new Date(o.LastModified).toISOString()})`);
  }
}

async function downloadKey(key) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const s3 = makeS3();
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function writeOut(plainBuf, outPath) {
  fs.writeFileSync(outPath, plainBuf);
  console.log(`Restored → ${outPath} (${(plainBuf.length / 1024).toFixed(0)} KB)`);
  console.log('Verify with:  sqlite3 ' + outPath + ' "PRAGMA integrity_check;"');
}

function toPlain(buf, label) {
  if (isEncryptedBackup(buf)) return decryptBackup(buf);
  console.warn(`[restore] WARNING: "${label}" is not encrypted (legacy plaintext backup) — copying as-is.`);
  return buf;
}

(async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 25).join('\n').replace(/^ \*?/gm, ''));
    process.exit(0);
  }

  try {
    if (args[0] === '--list') { await listBackups(); return; }

    let source = args[0];
    let outPath = args[1];
    let buf;

    if (source === '--s3') {
      const key = args[1];
      if (!key) throw new Error('Usage: --s3 <object-key> [out.db]');
      outPath = args[2] || path.join(process.cwd(), path.basename(key).replace(/\.enc$/, ''));
      console.log(`Downloading s3://${BUCKET}/${key} …`);
      buf = await downloadKey(key);
    } else {
      if (!fs.existsSync(source)) throw new Error(`File not found: ${source}`);
      outPath = outPath || path.join(process.cwd(), path.basename(source).replace(/\.enc$/, '') || 'restored.db');
      buf = fs.readFileSync(source);
    }

    writeOut(toPlain(buf, source), outPath);
  } catch (err) {
    console.error('[restore] FAILED:', err.message);
    process.exit(1);
  }
})();
