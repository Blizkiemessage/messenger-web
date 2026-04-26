'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Base32 alphabet (RFC 4648)
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, output = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(str) {
  const s = str.toUpperCase().replace(/\s/g, '').replace(/=+$/, '');
  const bytes = [];
  let bits = 0, value = 0;
  for (const ch of s) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 character: ' + ch);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// HOTP (RFC 4226): HMAC-SHA1-based one-time password
function hotp(secret, counter, digits = 6) {
  const key = base32Decode(secret);
  const counterBuf = Buffer.alloc(8);
  // Write counter as big-endian 64-bit integer
  const hi = Math.floor(counter / 0x100000000);
  const lo = counter >>> 0;
  counterBuf.writeUInt32BE(hi, 0);
  counterBuf.writeUInt32BE(lo, 4);

  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (
    ((hmac[offset]     & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8)  |
    ((hmac[offset + 3] & 0xff))
  ) % (10 ** digits);

  return String(code).padStart(digits, '0');
}

/** Generate a random 20-byte secret encoded as base32 */
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/** Build the otpauth:// URI compatible with Google Authenticator, Authy, etc. */
function generateUri(secret, username, issuer = 'Blizkie') {
  const enc = encodeURIComponent;
  return `otpauth://totp/${enc(issuer)}:${enc(username)}?secret=${secret}&issuer=${enc(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Verify a 6-digit TOTP token.
 * Allows ±windowSteps time steps (each 30s) to account for clock skew.
 */
function verifyToken(secret, token, windowSteps = 1) {
  if (typeof token !== 'string' || !/^\d{6}$/.test(token)) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  const tokenBuf = Buffer.from(token);
  for (let delta = -windowSteps; delta <= windowSteps; delta++) {
    const expected = hotp(secret, counter + delta);
    if (crypto.timingSafeEqual(tokenBuf, Buffer.from(expected))) return true;
  }
  return false;
}

/** Generate n plain-text backup codes in XXXXXX-XXXXXX format */
function generateBackupCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const a = crypto.randomBytes(3).toString('hex').toUpperCase();
    const b = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `${a}-${b}`;
  });
}

/** Hash an array of plain backup codes into [{hash, used:false}] objects */
async function hashBackupCodes(codes) {
  const hashed = await Promise.all(codes.map(c => bcrypt.hash(c, 8)));
  return hashed.map(hash => ({ hash, used: false }));
}

/**
 * Try to consume a backup code for userId.
 * Normalizes input, checks against stored hashes, marks used on match.
 * Returns true if a valid unused code was consumed, false otherwise.
 */
async function verifyAndConsumeBackupCode(userId, inputCode, db) {
  const user = db.prepare('SELECT totp_backup_codes FROM users WHERE id = ?').get(userId);
  if (!user || !user.totp_backup_codes) return false;

  let codes;
  try { codes = JSON.parse(user.totp_backup_codes); }
  catch { return false; }
  if (!Array.isArray(codes)) return false;

  const normalized = inputCode.toUpperCase().replace(/\s/g, '');

  for (let i = 0; i < codes.length; i++) {
    if (codes[i].used) continue;
    const valid = await bcrypt.compare(normalized, codes[i].hash);
    if (valid) {
      codes[i] = { ...codes[i], used: true };
      db.prepare('UPDATE users SET totp_backup_codes = ? WHERE id = ?')
        .run(JSON.stringify(codes), userId);
      return true;
    }
  }
  return false;
}

module.exports = {
  generateSecret,
  generateUri,
  verifyToken,
  generateBackupCodes,
  hashBackupCodes,
  verifyAndConsumeBackupCode,
};
