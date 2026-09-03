const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { getDb } = require('../config/database');
const { signAccess, signRefresh } = require('../utils/jwt');
const { sanitizeUser: sanitizeUserFull, DEFAULT_ACCENT_COLOR } = require('./userService');
const { generateOtp } = require('../utils/otp');
const { sendOtpEmail, sendPasswordResetEmail } = require('../config/email');
const crypto = require('crypto');

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// DEFAULT_ACCENT_COLOR (imported above) is passed explicitly on every user
// INSERT below — relying on the users.accent_color column DEFAULT silently gave
// every new account the retired pre-«Аврора» blue.

/**
 * Creates a session + refresh token record in one place.
 * Returns { accessToken, refreshToken, sessionId }.
 */
function createSessionWithTokens(db, userId, userAgent, ipAddress, now) {
  const sessionId      = uuidv4();
  const refreshTokenId = uuidv4();

  db.prepare(
    'INSERT INTO sessions (id, user_id, created_at, revoked, user_agent, last_used_at, ip_address) VALUES (?, ?, ?, 0, ?, ?, ?)'
  ).run([sessionId, userId, now, userAgent, now, ipAddress || null]);

  db.prepare(
    'INSERT INTO refresh_tokens (id, session_id, user_id, expires_at, revoked, created_at) VALUES (?, ?, ?, ?, 0, ?)'
  ).run([refreshTokenId, sessionId, userId, now + REFRESH_TTL_MS, now]);

  const accessToken  = signAccess({ sub: userId, jti: sessionId });
  const refreshToken = signRefresh({ sub: userId, jti: refreshTokenId, purpose: 'refresh' });

  return { accessToken, refreshToken, sessionId };
}

// Pre-computed bcrypt hash used only for constant-time dummy comparison.
// Ensures "user not found" and "wrong password" take the same time to respond,
// preventing timing-based account enumeration.
const DUMMY_HASH = bcrypt.hashSync('__dummy_timing_normalization__', 10);

// Single generic message returned for all login failures — prevents
// distinguishing "user not found" from "wrong password" by error text.
const authError = () => Object.assign(new Error('Неверный логин или пароль'), { status: 401 });

// Enforces min-8 + at least one digit or special character.
function validatePassword(password) {
  if (!password || password.length < 8) {
    throw Object.assign(new Error('Пароль: минимум 8 символов'), { status: 400 });
  }
  if (!/[0-9!@#$%^&*()\-_=+[\]{}|;:'",.<>?/\\`~]/.test(password)) {
    throw Object.assign(
      new Error('Пароль должен содержать хотя бы одну цифру или специальный символ'),
      { status: 400 }
    );
  }
}

/**
 * Login by username or email + password.
 * If login contains '@' — looks up by email, otherwise by username.
 * Passwordless login is intentionally not supported.
 */
async function loginOrRegister(login, password, userAgent = '', ipAddress = '') {
  const db = getDb();
  const clean = login.trim().toLowerCase();

  const now = Date.now();
  let user;

  if (clean.includes('@')) {
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(clean);
  } else {
    if (!/^[a-z0-9_]{3,32}$/.test(clean)) {
      throw Object.assign(
        new Error('Username: 3–32 символа, только латиница, цифры и _'),
        { status: 400 }
      );
    }
    user = db.prepare('SELECT * FROM users WHERE username = ?').get(clean);
  }

  // Always run bcrypt regardless of whether the user exists or has a password hash.
  // This normalizes response time so attackers cannot detect account existence via timing.
  const hashToCompare = user?.password_hash || DUMMY_HASH;
  const valid = await bcrypt.compare(password || '', hashToCompare);

  // Reject if: user not found, no password supplied, hash mismatch, or account has no hash
  if (!user || !password || !user.password_hash || !valid) {
    throw authError();
  }

  // Banned accounts never get a session — checked here so both the plain and
  // the 2FA-pending path (below) are covered by one check. Unlike authError()
  // above, this intentionally reveals the reason: credentials were already
  // confirmed correct, so there's no enumeration risk left to protect against.
  if (user.is_banned) {
    throw Object.assign(
      new Error(user.ban_reason ? `Аккаунт заблокирован: ${user.ban_reason}` : 'Аккаунт заблокирован'),
      { status: 403 }
    );
  }

  // If TOTP is enabled, signal to the caller — do NOT create a session yet
  if (user.totp_enabled) {
    return { totpRequired: true, userId: user.id };
  }

  db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run([now, user.id]);

  const { accessToken, refreshToken, sessionId } = createSessionWithTokens(db, user.id, userAgent, ipAddress, now);
  return { accessToken, refreshToken, sessionId, user: sanitizeUserFull(user, { showPrivate: true }) };
}

/**
 * Explicit registration with username + password.
 * Fails if username already taken.
 */
async function registerWithPassword(username, password, userAgent = '', ipAddress = '') {
  const db = getDb();
  const clean = username.trim().toLowerCase();

  if (!/^[a-z0-9_]{3,32}$/.test(clean)) {
    throw Object.assign(
      new Error('Username: 3–32 символа, только латиница, цифры и _'),
      { status: 400 }
    );
  }
  validatePassword(password);

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(clean);
  if (existing) {
    throw Object.assign(new Error('Этот username уже занят'), { status: 409 });
  }

  const hash = await bcrypt.hash(password, 10);
  const now = Date.now();
  const userId = uuidv4();

  db.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, accent_color, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run([userId, clean, clean, hash, DEFAULT_ACCENT_COLOR, now, now]);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const { accessToken, refreshToken, sessionId } = createSessionWithTokens(db, userId, userAgent, ipAddress, now);
  return { accessToken, refreshToken, sessionId, user: sanitizeUserFull(user, { showPrivate: true }), isNew: true };
}

/**
 * Set or change password for an existing user.
 * Requires current password when one is already set.
 */
async function setUserPassword(userId, newPassword, currentPassword) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

  validatePassword(newPassword);

  if (user.password_hash) {
    if (!currentPassword) {
      throw Object.assign(new Error('Введите текущий пароль'), { status: 400 });
    }
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      throw Object.assign(new Error('Неверный текущий пароль'), { status: 401 });
    }
  }

  const hash = await bcrypt.hash(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run([hash, userId]);
}

/**
 * Step 1 of email-verified registration.
 * Validates input, sends OTP to email, stores pending record in otps table.
 * `acceptedTerms` must be explicitly true — enforced server-side too (not
 * just the RegisterForm checkbox) so the API can't be hit directly to skip
 * consent (§1 of docs/STORE_LAUNCH_TZ.md).
 * Returns { email } on success.
 */
async function initiateRegistration(username, email, password, acceptedTerms) {
  const db = getDb();
  const cleanUser = username.trim().toLowerCase();
  const cleanEmail = email.trim().toLowerCase();

  if (!/^[a-z0-9_]{3,32}$/.test(cleanUser)) {
    throw Object.assign(
      new Error('Username: 3–32 символа, только латиница, цифры и _'),
      { status: 400 }
    );
  }
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw Object.assign(new Error('Введите корректный email'), { status: 400 });
  }
  if (acceptedTerms !== true) {
    throw Object.assign(
      new Error('Нужно принять Условия использования и Политику конфиденциальности'),
      { status: 400 }
    );
  }
  validatePassword(password);

  const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUser);
  if (existingUser) {
    throw Object.assign(new Error('Этот username уже занят'), { status: 409 });
  }
  const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existingEmail) {
    throw Object.assign(new Error('Этот email уже используется'), { status: 409 });
  }

  // Invalidate any prior pending OTPs for this email
  db.prepare('UPDATE otps SET used = 1 WHERE target = ? AND used = 0').run(cleanEmail);

  const otp = generateOtp();
  const codeHash = await bcrypt.hash(otp, 10);
  const now = Date.now();
  const passwordHash = await bcrypt.hash(password, 10);
  const otpId = uuidv4();
  const meta = JSON.stringify({ username: cleanUser, password_hash: passwordHash, terms_accepted_at: now });

  db.prepare(
    `INSERT INTO otps (id, target, code_hash, expires_at, used, created_at, meta)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  ).run([otpId, cleanEmail, codeHash, now + 10 * 60 * 1000, now, meta]);

  await sendOtpEmail(cleanEmail, otp);

  return { email: cleanEmail };
}

/**
 * Step 2 of email-verified registration.
 * Verifies OTP, creates the user account, returns { token, user }.
 */
async function verifyEmailAndCreateAccount(email, otp, userAgent = '', ipAddress = '') {
  const db = getDb();
  const cleanEmail = email.trim().toLowerCase();

  const row = db.prepare(
    `SELECT * FROM otps
     WHERE target = ? AND used = 0 AND expires_at > ? AND meta IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`
  ).get([cleanEmail, Date.now()]);

  if (!row) {
    throw Object.assign(new Error('Код недействителен или истёк'), { status: 400 });
  }

  if ((row.attempts || 0) >= 5) {
    db.prepare('UPDATE otps SET used = 1 WHERE id = ?').run(row.id);
    throw Object.assign(new Error('Превышено количество попыток. Запросите новый код.'), { status: 429 });
  }

  const valid = await bcrypt.compare(otp, row.code_hash);
  if (!valid) {
    db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    throw Object.assign(new Error('Неверный код'), { status: 400 });
  }

  // Mark OTP used immediately to prevent replay
  db.prepare('UPDATE otps SET used = 1 WHERE id = ?').run(row.id);

  const { username, password_hash, terms_accepted_at } = JSON.parse(row.meta);
  const now = Date.now();

  // Race condition guard
  const takenUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (takenUser) {
    throw Object.assign(new Error('Этот username уже занят'), { status: 409 });
  }
  const takenEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (takenEmail) {
    throw Object.assign(new Error('Этот email уже используется'), { status: 409 });
  }

  const userId = uuidv4();
  db.prepare(
    `INSERT INTO users (id, username, display_name, email, password_hash, accent_color, created_at, last_seen_at, terms_accepted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run([userId, username, username, cleanEmail, password_hash, DEFAULT_ACCENT_COLOR, now, now, terms_accepted_at || now]);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const { accessToken, refreshToken, sessionId } = createSessionWithTokens(db, userId, userAgent, ipAddress, now);
  return { accessToken, refreshToken, sessionId, user: sanitizeUserFull(user, { showPrivate: true }), isNew: true };
}

/**
 * Step 1 of email change for an existing user.
 * Sends OTP to the new email address.
 */
async function initiateEmailChange(userId, newEmail) {
  const db = getDb();
  const cleanEmail = newEmail.trim().toLowerCase();

  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw Object.assign(new Error('Введите корректный email'), { status: 400 });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get([cleanEmail, userId]);
  if (existing) {
    throw Object.assign(new Error('Этот email уже используется'), { status: 409 });
  }

  // Invalidate prior pending email-change OTPs for this user+email
  db.prepare('UPDATE otps SET used = 1 WHERE target = ? AND used = 0').run(cleanEmail);

  const otp = generateOtp();
  const codeHash = await bcrypt.hash(otp, 10);
  const now = Date.now();
  const otpId = uuidv4();
  const meta = JSON.stringify({ userId, type: 'email_change' });

  db.prepare(
    `INSERT INTO otps (id, target, code_hash, expires_at, used, created_at, meta)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  ).run([otpId, cleanEmail, codeHash, now + 10 * 60 * 1000, now, meta]);

  const requester = db.prepare('SELECT language FROM users WHERE id = ?').get(userId);
  await sendOtpEmail(cleanEmail, otp, requester?.language);

  return { email: cleanEmail };
}

/**
 * Step 2 of email change: verify OTP and update user's email.
 */
async function verifyEmailChange(userId, email, otp) {
  const db = getDb();
  const cleanEmail = email.trim().toLowerCase();

  const row = db.prepare(
    `SELECT * FROM otps
     WHERE target = ? AND used = 0 AND expires_at > ? AND meta IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`
  ).get([cleanEmail, Date.now()]);

  if (!row) {
    throw Object.assign(new Error('Код недействителен или истёк'), { status: 400 });
  }

  const parsed = JSON.parse(row.meta);
  if (parsed.type !== 'email_change' || parsed.userId !== userId) {
    throw Object.assign(new Error('Код недействителен'), { status: 400 });
  }

  if ((row.attempts || 0) >= 5) {
    db.prepare('UPDATE otps SET used = 1 WHERE id = ?').run(row.id);
    throw Object.assign(new Error('Превышено количество попыток. Запросите новый код.'), { status: 429 });
  }

  const valid = await bcrypt.compare(otp, row.code_hash);
  if (!valid) {
    db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    throw Object.assign(new Error('Неверный код'), { status: 400 });
  }

  db.prepare('UPDATE otps SET used = 1 WHERE id = ?').run(row.id);

  // Final uniqueness check
  const taken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get([cleanEmail, userId]);
  if (taken) {
    throw Object.assign(new Error('Этот email уже используется'), { status: 409 });
  }

  db.prepare('UPDATE users SET email = ? WHERE id = ?').run([cleanEmail, userId]);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return sanitizeUserFull(user, { showPrivate: true });
}

/**
 * Step 1 of password reset.
 * Validates email exists, creates a signed reset token, sends link by email.
 */
async function initiateForgotPassword(email) {
  const db = getDb();
  const cleanEmail = email.trim().toLowerCase();

  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw Object.assign(new Error('Введите корректный email'), { status: 400 });
  }

  const user = db.prepare('SELECT id, language FROM users WHERE email = ?').get(cleanEmail);
  if (!user) {
    // Silently succeed — do not reveal whether the email is registered
    return { sent: true };
  }

  // Invalidate any prior reset tokens for this email
  db.prepare(
    `UPDATE otps SET used = 1 WHERE target = ? AND used = 0 AND meta LIKE '%"password_reset"%'`
  ).run(cleanEmail);

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = await bcrypt.hash(rawToken, 10);
  const now = Date.now();
  const otpId = uuidv4();
  const meta = JSON.stringify({ type: 'password_reset', userId: user.id });

  db.prepare(
    `INSERT INTO otps (id, target, code_hash, expires_at, used, created_at, meta)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  ).run([otpId, cleanEmail, tokenHash, now + 60 * 60 * 1000, now, meta]);

  const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
  const resetUrl = `${appUrl}/?rid=${otpId}&tok=${rawToken}`;

  await sendPasswordResetEmail(cleanEmail, resetUrl, user.language);
  return { sent: true };
}

/**
 * Step 2 of password reset.
 * Verifies the token, sets new password, revokes all existing sessions.
 */
async function resetPassword(id, rawToken, newPassword) {
  const db = getDb();

  if (!id || !rawToken) {
    throw Object.assign(new Error('Недействительная ссылка сброса пароля'), { status: 400 });
  }
  validatePassword(newPassword);

  const row = db.prepare(
    `SELECT * FROM otps WHERE id = ? AND used = 0 AND expires_at > ? AND meta IS NOT NULL`
  ).get([id, Date.now()]);

  if (!row) {
    throw Object.assign(new Error('Ссылка недействительна или истекла. Запросите новую.'), { status: 400 });
  }

  const parsed = JSON.parse(row.meta);
  if (parsed.type !== 'password_reset') {
    throw Object.assign(new Error('Недействительная ссылка'), { status: 400 });
  }

  if ((row.attempts || 0) >= 5) {
    db.prepare('UPDATE otps SET used = 1 WHERE id = ?').run(row.id);
    throw Object.assign(new Error('Превышено количество попыток. Запросите новую ссылку.'), { status: 429 });
  }

  const valid = await bcrypt.compare(rawToken, row.code_hash);
  if (!valid) {
    db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    throw Object.assign(new Error('Недействительная ссылка сброса пароля'), { status: 400 });
  }

  db.prepare('UPDATE otps SET used = 1 WHERE id = ?').run(row.id);

  const newHash = await bcrypt.hash(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run([newHash, parsed.userId]);

  // Revoke all existing sessions so the user logs in fresh
  db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ?').run(parsed.userId);

  return { ok: true };
}

module.exports = {
  loginOrRegister,
  sanitizeUser: sanitizeUserFull,
  registerWithPassword,
  setUserPassword,
  validatePassword,
  initiateRegistration,
  verifyEmailAndCreateAccount,
  initiateEmailChange,
  verifyEmailChange,
  initiateForgotPassword,
  resetPassword,
};
