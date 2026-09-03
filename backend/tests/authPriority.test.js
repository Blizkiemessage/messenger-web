'use strict';

/**
 * QA-прогон 2026-09-03 (docs/QA_FUNCTIONAL_MAP.md §1) — приоритет токена.
 *
 * The httpOnly `session`/`refresh` cookies are host-only and shared by the whole
 * browser profile: one cookie per host, regardless of port or tab. The access
 * token, by contrast, lives in each tab's own JS memory
 * (web/src/storage/session.ts). While the server preferred the cookie, the most
 * recent login in ANY tab silently won: an action performed in tab A was
 * recorded under the identity of whoever logged in last, and the admin panel
 * (which sends its own Bearer token) answered 403 for as long as a regular user
 * was logged in elsewhere in the same browser.
 *
 * These tests pin the corrected priority — the client's own token first, cookie
 * only as a fallback — for both the REST middleware and POST /auth/refresh.
 * The socket.io handshake half of the same fix is covered in tests/calls.test.js.
 *
 * Drives the REAL middleware and the REAL auth router over a real HTTP server —
 * same technique as tests/adminChats.test.js.
 */

process.env.MESSAGE_ENCRYPTION_KEY = '0'.repeat(64);
process.env.JWT_SECRET = 'auth-priority-test-jwt-secret';
process.env.NODE_ENV = 'test';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Database = require('better-sqlite3');

function mockModule(relPath, exports) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE, display_name TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT 0, last_seen_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0,
    revoked INTEGER NOT NULL DEFAULT 0, user_agent TEXT, last_used_at INTEGER, ip_address TEXT
  );
  CREATE TABLE refresh_tokens (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
`);
mockModule('../src/config/database', { getDb: () => db });
// Never touch a real SMTP server from the auth router's password-reset paths.
mockModule('../src/config/email', {
  sendOtpEmail: async () => {},
  sendPasswordResetEmail: async () => {},
  sendSupportEmail: async () => {},
  sendWarningEmail: async () => {},
});

const { signAccess, signRefresh, verify } = require('../src/utils/jwt');
const { authMiddleware } = require('../src/middleware/auth');
const authRouter = require('../src/routes/auth');

const NOW = Date.now();
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Two independent accounts, each with its own live session — the two browser
// tabs from the bug report.
for (const id of ['user-a', 'user-b']) {
  db.prepare('INSERT INTO users (id, username, display_name) VALUES (?,?,?)').run(id, id, id);
  db.prepare('INSERT INTO sessions (id, user_id, created_at, revoked, last_used_at) VALUES (?,?,?,0,?)')
    .run(`sess-${id}`, id, NOW, NOW);
  db.prepare('INSERT INTO refresh_tokens (id, session_id, user_id, expires_at, revoked, created_at) VALUES (?,?,?,?,0,?)')
    .run(`rt-${id}`, `sess-${id}`, id, NOW + REFRESH_TTL_MS, NOW);
}

const accessTokenFor  = (id) => signAccess({ sub: id, jti: `sess-${id}` });
const refreshTokenFor = (id) => signRefresh({ sub: id, jti: `rt-${id}`, purpose: 'refresh' });

let server, baseUrl;

before(async () => {
  const express = require('express');
  const cookieParser = require('cookie-parser');
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  // Minimal protected route — exercises the real authMiddleware, nothing else.
  app.get('/whoami', authMiddleware, (req, res) => res.json({ userId: req.userId, sessionId: req.sessionId }));
  app.use('/auth', authRouter);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function whoami({ bearer, cookie } = {}) {
  const headers = {};
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (cookie) headers.Cookie = cookie;
  return fetch(`${baseUrl}/whoami`, { headers });
}

describe('authMiddleware — the client\'s own Bearer token wins over the shared cookie', () => {
  test('Bearer of user A + session cookie of user B → request is user A', async () => {
    const res = await whoami({
      bearer: accessTokenFor('user-a'),
      cookie: `session=${accessTokenFor('user-b')}`,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.userId, 'user-a', 'the tab\'s own token must decide the identity');
    assert.equal(body.sessionId, 'sess-user-a');
  });

  test('cookie still authenticates when there is no Bearer (fallback preserved)', async () => {
    const res = await whoami({ cookie: `session=${accessTokenFor('user-b')}` });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).userId, 'user-b');
  });

  test('a Bearer token is honoured with no cookie at all (admin panel / API clients)', async () => {
    const res = await whoami({ bearer: accessTokenFor('user-b') });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).userId, 'user-b');
  });

  test('an invalid Bearer is rejected instead of silently falling through to a valid cookie', async () => {
    // Falling back here would resurrect the very bug this fixes: a request would
    // be served under a different account than the one the client meant.
    const res = await whoami({ bearer: 'not-a-jwt', cookie: `session=${accessTokenFor('user-b')}` });
    assert.equal(res.status, 401);
  });

  test('no token at all → 401', async () => {
    assert.equal((await whoami()).status, 401);
  });

  test('a revoked session is rejected even when presented as a Bearer token', async () => {
    db.prepare('INSERT INTO users (id, username, display_name) VALUES (?,?,?)').run('user-c', 'user-c', 'user-c');
    db.prepare('INSERT INTO sessions (id, user_id, created_at, revoked) VALUES (?,?,?,1)').run('sess-user-c', 'user-c', NOW);
    const res = await whoami({ bearer: accessTokenFor('user-c') });
    assert.equal(res.status, 401);
  });
});

describe('POST /auth/refresh — the body\'s refresh token wins over the shared cookie', () => {
  test('body token of user A + refresh cookie of user B → new tokens belong to user A', async () => {
    const res = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `refresh=${refreshTokenFor('user-b')}`,
      },
      body: JSON.stringify({ refreshToken: refreshTokenFor('user-a') }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(verify(body.token).sub, 'user-a', 'rotated access token must belong to the body token\'s owner');
    assert.equal(verify(body.token).jti, 'sess-user-a');
    assert.equal(verify(body.refreshToken).sub, 'user-a');

    // Rotation must have consumed A's token — and left B's alone.
    assert.equal(db.prepare('SELECT revoked FROM refresh_tokens WHERE id = ?').get('rt-user-a').revoked, 1);
    assert.equal(db.prepare('SELECT revoked FROM refresh_tokens WHERE id = ?').get('rt-user-b').revoked, 0);
  });

  test('the refresh cookie is still accepted when the body carries nothing (fallback preserved)', async () => {
    const res = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `refresh=${refreshTokenFor('user-b')}` },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    assert.equal(verify((await res.json()).token).sub, 'user-b');
  });

  test('no refresh token anywhere → 401', async () => {
    const res = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 401);
  });
});
