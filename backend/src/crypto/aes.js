const crypto = require('crypto');

// Key must be 32 bytes (64 hex chars). Derived once at startup.
function getKey() {
  const hex = process.env.MESSAGE_ENCRYPTION_KEY;
  if (!hex || hex.length < 64) {
    throw new Error('MESSAGE_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
  }
  return Buffer.from(hex.slice(0, 64), 'hex');
}

/**
 * Encrypts a UTF-8 plaintext string.
 * Returns { ciphertext, iv, authTag } — all base64 strings.
 */
function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypts a message produced by encrypt().
 * Returns the original plaintext string.
 */
function decrypt({ ciphertext, iv, authTag }) {
  const key = getKey();
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

module.exports = { encrypt, decrypt };
