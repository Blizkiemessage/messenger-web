'use strict';

/**
 * Regression coverage for the Cyrillic-search bug in routes/admin/chats.js's
 * GET /chats?search=<query>: it used to build the SQL LIKE pattern with JS's
 * (Unicode-aware) toLowerCase() but compare it against SQLite's LOWER(name)
 * (ASCII-only — no ICU extension loaded), so a chat named "Тестовая группа"
 * never matched a search for "тестовая". Found 2026-07-10 while testing an
 * unrelated admin-panel CSP refactor. Fixed by filtering in JS on both sides
 * instead (mirrors the admin UI's own Pages.users.search() client-side
 * filtering, and messageService's in-memory search pattern).
 *
 * Spins up the real admin.js router (login + auth + isAdmin gate + the chats
 * sub-router) behind a real HTTP server, and drives it with real requests —
 * same technique as tests/upload.test.js.
 */

process.env.MESSAGE_ENCRYPTION_KEY = '0'.repeat(64);
process.env.JWT_SECRET = 'admin-chats-test-jwt-secret';
process.env.NODE_ENV = 'test';
process.env.ADMIN_USERNAME = 'admintest';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('AdminTest123!', 10);

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Database = require('better-sqlite3');

function mockModule(relPath, exports) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE);
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0, user_agent TEXT, last_used_at INTEGER, ip_address TEXT
  );
  CREATE TABLE chats (
    id TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'group', name TEXT,
    created_at INTEGER NOT NULL, creator_id TEXT
  );
  CREATE TABLE chat_members (chat_id TEXT NOT NULL, user_id TEXT NOT NULL);
`);
mockModule('../src/config/database', { getDb: () => db });

const NOW = Date.now();
db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run('admin-1', 'admintest');
db.prepare('INSERT INTO chats (id, type, name, created_at) VALUES (?,?,?,?)').run('chat-1', 'group', 'Тестовая группа', NOW);
db.prepare('INSERT INTO chats (id, type, name, created_at) VALUES (?,?,?,?)').run('chat-2', 'group', 'English Chat', NOW - 1000);
db.prepare('INSERT INTO chats (id, type, name, created_at) VALUES (?,?,?,?)').run('chat-3', 'direct', null, NOW - 2000);

const adminRouter = require('../src/routes/admin');

let server, baseUrl, token;

before(async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/admin/api', adminRouter);
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}/admin/api`;

  const res = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admintest', password: 'AdminTest123!' }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, `login failed: ${JSON.stringify(body)}`);
  token = body.token;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});

async function searchChats(q) {
  const res = await fetch(`${baseUrl}/chats?search=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  return res.json();
}

describe('GET /admin/api/chats?search= — Unicode-correct case-insensitive matching', () => {
  test('finds a Cyrillic chat name by a lowercase Cyrillic query', async () => {
    const rows = await searchChats('тестовая');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Тестовая группа');
  });

  test('matches regardless of the query\'s casing', async () => {
    for (const q of ['ТЕСТОВАЯ', 'Тестовая', 'тЕсТоВаЯ']) {
      const rows = await searchChats(q);
      assert.equal(rows.length, 1, `query "${q}" should match`);
      assert.equal(rows[0].name, 'Тестовая группа');
    }
  });

  test('still matches ASCII names case-insensitively (no regression)', async () => {
    const rows = await searchChats('english');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'English Chat');
  });

  test('substring match works, not just prefix', async () => {
    const rows = await searchChats('группа');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Тестовая группа');
  });

  test('no match returns an empty array', async () => {
    const rows = await searchChats('nonexistent');
    assert.deepEqual(rows, []);
  });

  test('no search param returns every chat, including nameless direct chats', async () => {
    const res = await fetch(`${baseUrl}/chats`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.equal(rows.length, 3);
  });
});
