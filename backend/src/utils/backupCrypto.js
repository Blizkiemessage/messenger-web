'use strict';

/**
 * backupCrypto.js — application-level encryption for DB backups.
 *
 * ── Why ──────────────────────────────────────────────────────────────────────
 * Backups are uploaded to the same object storage as media and (by default) with
 * the same credentials. Server-side encryption (SSE) would NOT help against the
 * real threat — anyone holding the bucket keys can still GET the object and the
 * provider decrypts it transparently. So we encrypt the backup *before* it leaves
 * the process, with a key that lives only in the server environment. Without that
 * key the backup blob is useless, even to someone with full S3 access.
 *
 * ── Key ──────────────────────────────────────────────────────────────────────
 * Uses DB_BACKUP_ENCRYPTION_KEY (64 hex chars = 32 bytes) when set — this gives
 * true key separation (a leak of the message key does not expose backups).
 * Otherwise derives a DISTINCT 32-byte key from MESSAGE_ENCRYPTION_KEY via HKDF,
 * so backups are ALWAYS encrypted with zero extra configuration, yet the message
 * key is never reused verbatim. Set the dedicated key in production for the
 * strongest posture.
 *
 * ── Container format ─────────────────────────────────────────────────────────
 *   [ magic(5) = "BZKB1" ][ iv(12) ][ authTag(16) ][ ciphertext(...) ]
 * AES-256-GCM. The auth tag is verified on decrypt, so any tampering or wrong
 * key fails loudly instead of yielding a corrupt DB.
 */

const crypto = require('crypto');

const MAGIC = Buffer.from('BZKB1', 'ascii'); // 5 bytes
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + IV_LEN + TAG_LEN; // 33

/** Resolve the 32-byte backup key (dedicated env key or HKDF-derived). */
function getBackupKey() {
  const explicit = (process.env.DB_BACKUP_ENCRYPTION_KEY || '').trim();
  if (explicit) {
    if (!/^[0-9a-fA-F]{64}$/.test(explicit)) {
      throw new Error('DB_BACKUP_ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
    }
    return Buffer.from(explicit, 'hex');
  }
  const msgKey = (process.env.MESSAGE_ENCRYPTION_KEY || '').trim();
  if (!msgKey || msgKey.length < 64) {
    throw new Error('No backup key available: set DB_BACKUP_ENCRYPTION_KEY or MESSAGE_ENCRYPTION_KEY');
  }
  // HKDF with a fixed info string → a key distinct from the message key.
  const derived = crypto.hkdfSync(
    'sha256',
    Buffer.from(msgKey.slice(0, 64), 'hex'),
    Buffer.alloc(0),                       // no salt — deterministic so any instance can decrypt
    Buffer.from('blizkie-db-backup-v1'),   // info / context binding
    32,
  );
  return Buffer.from(derived);
}

/** True if the buffer carries our encrypted-backup magic header. */
function isEncryptedBackup(buf) {
  return Buffer.isBuffer(buf) && buf.length >= HEADER_LEN && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

/** Encrypt a plaintext backup buffer → encrypted container buffer. */
function encryptBackup(plainBuf) {
  const key = getBackupKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, authTag, ciphertext]);
}

/** Decrypt an encrypted container buffer → original plaintext buffer. */
function decryptBackup(buf) {
  if (!isEncryptedBackup(buf)) {
    throw new Error('Not an encrypted Blizkie backup (bad magic header)');
  }
  const key = getBackupKey();
  const iv = buf.subarray(MAGIC.length, MAGIC.length + IV_LEN);
  const authTag = buf.subarray(MAGIC.length + IV_LEN, HEADER_LEN);
  const ciphertext = buf.subarray(HEADER_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

module.exports = { encryptBackup, decryptBackup, isEncryptedBackup, getBackupKey, MAGIC };
