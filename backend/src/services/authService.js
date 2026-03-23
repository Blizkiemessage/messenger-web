const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { getDb } = require('../config/database');
const { sign } = require('../utils/jwt');
<<<<<<< HEAD

function sanitizeUser(u) {
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    avatar_url: u.avatar_url,
    created_at: u.created_at,
    last_seen_at: u.last_seen_at,
    has_password: !!u.password_hash,
  };
}
=======
const { sanitizeUser: sanitizeUserFull } = require('./userService');

// ✅ sanitizeUser imported from userService (includes hide_avatar, privacy fields)
>>>>>>> devDK

/**
 * Username-only login (creates account if not exists).
 * If password is provided, verifies it against stored hash.
 */
async function loginOrRegister(username, password) {
  const db = getDb();
  const clean = username.trim().toLowerCase();

  if (!/^[a-z0-9_]{3,32}$/.test(clean)) {
    throw Object.assign(
      new Error('Username: 3–32 символа, только латиница, цифры и _'),
      { status: 400 }
    );
  }

  const now = Date.now();
  let user = db.prepare('SELECT * FROM users WHERE username = ?').get(clean);

  if (password) {
    if (!user) {
      throw Object.assign(new Error('Пользователь не найден'), { status: 404 });
    }
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
    db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run([now, user.id]);
  } else {
    if (!user) {
      const userId = uuidv4();
      db.prepare(
        `INSERT INTO users (id, username, display_name, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run([userId, clean, clean, now, now]);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    } else {
      db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run([now, user.id]);
    }
  }

  const sessionId = uuidv4();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, revoked) VALUES (?, ?, ?, 0)')
    .run([sessionId, user.id, now]);

  const token = sign({ sub: user.id, jti: sessionId });
<<<<<<< HEAD
  return { token, user: sanitizeUser(user) };
=======
  return { token, user: sanitizeUserFull(user, { showPrivate: true }) };
>>>>>>> devDK
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
<<<<<<< HEAD
  return { token, user: sanitizeUser(user), isNew: true };
=======
  return { token, user: sanitizeUserFull(user, { showPrivate: true }), isNew: true };
>>>>>>> devDK
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

<<<<<<< HEAD
module.exports = { loginOrRegister, sanitizeUser, registerWithPassword, setUserPassword };
=======
module.exports = { loginOrRegister, sanitizeUser: sanitizeUserFull, registerWithPassword, setUserPassword };
>>>>>>> devDK
