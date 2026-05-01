#!/usr/bin/env node
/**
 * create-admin.js — interactive CLI for creating / resetting the admin user.
 *
 * Usage:
 *   node scripts/create-admin.js
 *
 * What it does:
 *   1. Prompts for username, optional email, password (with confirmation).
 *   2. Creates the user in the DB (or updates password_hash if already exists).
 *   3. Prints the two env-var values you must add to your deployment config:
 *        ADMIN_USERNAME=<username>
 *        ADMIN_PASSWORD_HASH=<bcrypt hash>
 *
 * The admin panel login validates against these env vars — not the DB password —
 * so the hash printed here is the one that matters for /admin access.
 */

'use strict';

// ── Bootstrap ──────────────────────────────────────────────────────────────
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const readline = require('readline/promises');
const { stdin: input, stdout: output } = process;
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 }   = require('uuid');
const { getDb }        = require('../src/config/database');
const { runMigrations } = require('../src/db/migrations');

// ── Helpers ────────────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  white:  '\x1b[37m',
};

function print(msg)  { process.stdout.write(msg + '\n'); }
function hr()        { print(c.dim + '─'.repeat(60) + c.reset); }
function ok(msg)     { print(c.green  + '✓ ' + c.reset + msg); }
function warn(msg)   { print(c.yellow + '⚠ ' + c.reset + msg); }
function err(msg)    { print(c.red    + '✗ ' + c.reset + msg); }
function info(msg)   { print(c.cyan   + '→ ' + c.reset + msg); }

function validateUsername(u) {
  if (!u || u.length < 3 || u.length > 32)        return 'Username: от 3 до 32 символов';
  if (!/^[a-z0-9_]+$/.test(u))                    return 'Username: только латиница в нижнем регистре, цифры и _';
  return null;
}

function validatePassword(p) {
  if (!p || p.length < 8)                          return 'Пароль: минимум 8 символов';
  if (!/[0-9!@#$%^&*()\-_=+[\]{}|;:'",.<>?/\\`~]/.test(p))
    return 'Пароль должен содержать хотя бы одну цифру или специальный символ';
  return null;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  hr();
  print(c.bold + c.cyan + '  Blizkie Admin Setup — создание/обновление admin-пользователя' + c.reset);
  hr();
  print('');

  // Ensure DB is ready
  try {
    runMigrations();
    ok('База данных инициализирована');
  } catch (e) {
    err('Не удалось инициализировать БД: ' + e.message);
    process.exit(1);
  }

  const rl = readline.createInterface({ input, output, terminal: true });

  try {
    // ── Username ────────────────────────────────────────────────────────────
    let username;
    while (true) {
      const raw = (await rl.question(c.bold + '  Username: ' + c.reset)).trim().toLowerCase();
      const v = validateUsername(raw);
      if (v) { err(v); continue; }
      username = raw;
      break;
    }

    // ── Email (optional) ────────────────────────────────────────────────────
    let email = null;
    const rawEmail = (await rl.question(c.bold + '  Email (Enter — пропустить): ' + c.reset)).trim().toLowerCase();
    if (rawEmail) {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
        email = rawEmail;
      } else {
        warn('Email недействителен — пропущен');
      }
    }

    // ── Password ────────────────────────────────────────────────────────────
    let password;
    while (true) {
      const p1 = await rl.question(c.bold + '  Пароль: ' + c.reset);
      const v = validatePassword(p1);
      if (v) { err(v); continue; }

      const p2 = await rl.question(c.bold + '  Подтвердите пароль: ' + c.reset);
      if (p1 !== p2) { err('Пароли не совпадают'); continue; }

      password = p1;
      break;
    }

    print('');
    info('Хэширование пароля (bcrypt, 12 раундов)…');
    const passwordHash = await bcrypt.hash(password, 12);

    // ── Create or update user ───────────────────────────────────────────────
    const db = getDb();
    const existing = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);

    const now = Date.now();
    let userId;

    if (existing) {
      warn(`Пользователь @${username} уже существует — обновляем password_hash`);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run([passwordHash, existing.id]);
      if (email) {
        db.prepare('UPDATE users SET email = ? WHERE id = ?').run([email, existing.id]);
      }
      userId = existing.id;
      ok('Пользователь обновлён');
    } else {
      userId = uuidv4();
      db.prepare(
        `INSERT INTO users (id, username, display_name, email, password_hash, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run([userId, username, username, email, passwordHash, now, now]);
      ok(`Пользователь @${username} создан (ID: ${userId})`);
    }

    // ── Print env values ────────────────────────────────────────────────────
    print('');
    hr();
    print(c.bold + c.green + '  Готово! Добавьте эти переменные в настройки Amvera:' + c.reset);
    hr();
    print('');
    print(c.bold + '  ADMIN_USERNAME' + c.reset + '=' + c.cyan + username + c.reset);
    print(c.bold + '  ADMIN_PASSWORD_HASH' + c.reset + '=' + c.yellow + passwordHash + c.reset);
    print('');
    print(c.dim + '  Примечание: хэш содержит $ — в Amvera вводите его в поле "Значение" UI,');
    print('  а не через CLI, чтобы избежать экранирования оболочки.' + c.reset);
    print('');
    hr();
    print('');

  } finally {
    rl.close();
    process.exit(0);
  }
}

main().catch(e => {
  err('Неожиданная ошибка: ' + e.message);
  process.exit(1);
});
