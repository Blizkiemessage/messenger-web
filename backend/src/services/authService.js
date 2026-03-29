const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { getDb } = require('../config/database');
const { sign } = require('../utils/jwt');
const { sanitizeUser: sanitizeUserFull } = require('./userService');
const { generateOtp } = require('../utils/otp');
const { sendOtpEmail } = require('../config/email');

// ✅ sanitizeUser imported from userService (includes hide_avatar, privacy fields)

/**
 * Login by username or email + optional password.
 * If login contains '@' — looks up by email, otherwise by username.
 */
async function loginOrRegister(login, password) {
  const db = getDb();
  const clean = login.trim().toLowerCase();

  const now = Date.now();
  let user;

  if (clean.includes('@')) {
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(clean);
    if (!user) {
      throw Object.assign(new Error('Пользователь с таким email не найден'), { status: 404 });
    }
  } else {
    if (!/^[a-z0-9_]{3,32}$/.test(clean)) {
      throw Object.assign(
        new Error('Username: 3–32 символа, только латиница, цифры и _'),
        { status: 400 }
      );
    }
    user = db.prepare('SELECT * FROM users WHERE username = ?').get(clean);
  }

  if (!user) {
    throw Object.assign(new Error('Пользователь не найден'), { status: 404 });
  }

  if (password) {
    if (!user.password_hash) {
      throw Object.assign(
        new Error('У этого аккаунта нет пароля. Войдите просто по username.'),
        { status: 400 }
      );
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw Object.assign(new Error('Неверный пароль'), { status: 401 });
    }
  }

  db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run([now, user.id]);

  const sessionId = uuidv4();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, revoked) VALUES (?, ?, ?, 0)')
    .run([sessionId, user.id, now]);

  const token = sign({ sub: user.id, jti: sessionId });
  return { token, user: sanitizeUserFull(user, { showPrivate: true }) };
}

/**
 * Explicit registration with username + password.
 * Fails if username already taken.
 */
async function registerWithPassword(username, password) {
  const db = getDb();
  const clean = username.trim().toLowerCase();

  if (!/^[a-z0-9_]{3,32}$/.test(clean)) {
    throw Object.assign(
      new Error('Username: 3–32 символа, только латиница, цифры и _'),
      { status: 400 }
    );
  }
  if (!password || password.length < 6) {
    throw Object.assign(new Error('Пароль: минимум 6 символов'), { status: 400 });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(clean);
  if (existing) {
    throw Object.assign(new Error('Этот username уже занят'), { status: 409 });
  }

  const hash = await bcrypt.hash(password, 10);
  const now = Date.now();
  const userId = uuidv4();

  db.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run([userId, clean, clean, hash, now, now]);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const sessionId = uuidv4();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, revoked) VALUES (?, ?, ?, 0)')
    .run([sessionId, userId, now]);

  const token = sign({ sub: userId, jti: sessionId });
  return { token, user: sanitizeUserFull(user, { showPrivate: true }), isNew: true };
}

/**
 * Set or change password for an existing user.
 * Requires current password when one is already set.
 */
async function setUserPassword(userId, newPassword, currentPassword) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

  if (!newPassword || newPassword.length < 6) {
    throw Object.assign(new Error('Пароль: минимум 6 символов'), { status: 400 });
  }

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
 * Returns { email } on success.
 */
async function initiateRegistration(username, email, password) {
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
  if (!password || password.length < 6) {
    throw Object.assign(new Error('Пароль: минимум 6 символов'), { status: 400 });
  }

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
  const meta = JSON.stringify({ username: cleanUser, password_hash: passwordHash });

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
async function verifyEmailAndCreateAccount(email, otp) {
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

  const valid = await bcrypt.compare(otp, row.code_hash);
  if (!valid) {
    throw Object.assign(new Error('Неверный код'), { status: 400 });
  }

  // Mark OTP used immediately to prevent replay
  db.prepare('UPDATE otps SET used = 1 WHERE id = ?').run(row.id);

  const { username, password_hash } = JSON.parse(row.meta);
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
    `INSERT INTO users (id, username, display_name, email, password_hash, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run([userId, username, username, cleanEmail, password_hash, now, now]);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const sessionId = uuidv4();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, revoked) VALUES (?, ?, ?, 0)')
    .run([sessionId, userId, now]);

  const token = sign({ sub: userId, jti: sessionId });
  return { token, user: sanitizeUserFull(user, { showPrivate: true }), isNew: true };
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

  await sendOtpEmail(cleanEmail, otp);

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

  const valid = await bcrypt.compare(otp, row.code_hash);
  if (!valid) {
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

module.exports = {
  loginOrRegister,
  sanitizeUser: sanitizeUserFull,
  registerWithPassword,
  setUserPassword,
  initiateRegistration,
  verifyEmailAndCreateAccount,
  initiateEmailChange,
  verifyEmailChange,
};
