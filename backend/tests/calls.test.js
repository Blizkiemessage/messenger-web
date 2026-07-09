'use strict';

/**
 * docs/STORE_LAUNCH_TZ.md §10 — backend call signaling coverage.
 *
 * Spins up a REAL socket.io server (initSocket from socket/socketServer.js)
 * on an ephemeral port and drives it with real socket.io-client connections
 * (same technique used ad hoc in past manual verification sessions — see
 * CLAUDE.md 2026-07-08 "глобальная история звонков" entry). This exercises
 * the actual auth middleware, room joins and call:* handlers end to end,
 * rather than mocking socket.io's internals.
 */

process.env.MESSAGE_ENCRYPTION_KEY = '0'.repeat(64);
process.env.JWT_SECRET = 'calls-test-jwt-secret';
process.env.NODE_ENV = 'test';
// Server-side missed-call timeout — configurable (see socketServer.js) so this
// suite doesn't have to wait the real 90 s to exercise the missed-call path.
process.env.CALL_MISSED_TIMEOUT_MS = '250';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Database = require('better-sqlite3');
const { io: ioClient } = require('socket.io-client');

// ── In-memory SQLite — only the tables initSocket's connection/call paths touch ──
const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    display_name TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    last_seen_at INTEGER NOT NULL DEFAULT 0,
    hide_avatar INTEGER NOT NULL DEFAULT 0,
    avatar_exceptions TEXT NOT NULL DEFAULT '[]',
    hide_last_seen INTEGER NOT NULL DEFAULT 0,
    presence_status TEXT,
    presence_note TEXT,
    presence_expires_at INTEGER,
    language TEXT
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE chats (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'group',
    name TEXT,
    description TEXT,
    avatar_url TEXT,
    created_at INTEGER NOT NULL,
    creator_id TEXT,
    is_closed INTEGER NOT NULL DEFAULT 0,
    chat_bg TEXT,
    chat_bg_updated_at INTEGER
  );
  CREATE TABLE chat_members (
    chat_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at INTEGER NOT NULL DEFAULT 0,
    permissions TEXT,
    last_read_at INTEGER NOT NULL DEFAULT 0,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    pin_order INTEGER,
    is_muted INTEGER NOT NULL DEFAULT 0,
    unread_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, user_id)
  );
  CREATE TABLE chat_backgrounds (
    user_id TEXT NOT NULL, chat_id TEXT NOT NULL, bg TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, chat_id)
  );
  CREATE TABLE contact_aliases (
    user_id TEXT NOT NULL, target_id TEXT NOT NULL, alias TEXT,
    PRIMARY KEY (user_id, target_id)
  );
  CREATE TABLE blocked_users (
    blocker_id TEXT NOT NULL, blocked_id TEXT NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id)
  );
  CREATE TABLE messages (
    id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, created_at INTEGER NOT NULL,
    deleted_at INTEGER, is_delivered INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE calls (
    id TEXT PRIMARY KEY, chat_id TEXT NOT NULL,
    caller_id TEXT NOT NULL REFERENCES users(id),
    callee_id TEXT NOT NULL REFERENCES users(id),
    call_type TEXT NOT NULL DEFAULT 'audio', status TEXT NOT NULL DEFAULT 'pending',
    started_at INTEGER, ended_at INTEGER, duration INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE push_subscriptions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth_key TEXT NOT NULL
  );
`);

function mockModule(relPath, exports) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
mockModule('../src/config/database', { getDb: () => db });

const { signAccess } = require('../src/utils/jwt');
const { initSocket } = require('../src/socket/socketServer');

// ── Seed: one shared chat, everyone a member except 'ivan' (used by the not_member test) ──
const NOW = Date.now();
const USERS = [
  'alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'george', 'henry', 'grace',
  'erin2', 'frank2', 'alice2', 'henry2', // isolated identities for busy/not_member/rate-limit cases
  'ivan',
];
for (const id of USERS) {
  db.prepare('INSERT INTO users (id, username, display_name, last_seen_at) VALUES (?,?,?,?)').run(id, id, id, NOW);
  db.prepare('INSERT INTO sessions (id, user_id, revoked) VALUES (?,?,0)').run(`sess-${id}`, id);
}
db.prepare('INSERT INTO chats (id, type, name, created_at) VALUES (?,?,?,?)').run('chat-main', 'group', 'Everyone', NOW);
for (const id of USERS) {
  if (id === 'ivan') continue; // deliberately not a member — used by the not_member test
  db.prepare('INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?,?,?,?)')
    .run('chat-main', id, 'member', NOW);
}

// ── HTTP + socket.io server ───────────────────────────────────────────────────
const httpServer = http.createServer();
const io = initSocket(httpServer);
const openSockets = [];
let port;

before(async () => {
  await new Promise((resolve) => httpServer.listen(0, resolve));
  port = httpServer.address().port;
});

after(async () => {
  for (const s of openSockets) { try { s.close(); } catch { /* ignore */ } }
  await new Promise((resolve) => io.close(() => resolve()));
  // initSocket schedules several setIntervals (presence expiry, scheduled
  // messages, daily prompts, session sweep) that would otherwise keep this
  // test file's child process alive indefinitely.
  setImmediate(() => process.exit(process.exitCode || 0));
});

function tokenFor(userId) {
  return signAccess({ sub: userId, jti: `sess-${userId}` });
}

async function connectAs(userId) {
  const socket = ioClient(`http://localhost:${port}`, {
    auth: { token: tokenFor(userId) },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  openSockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

function waitFor(socket, event, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeout);
    socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
  });
}

describe('call:* signaling', () => {
  test('invite -> accept -> connected -> end: full lifecycle, DB record, activeCalls cleanup', async () => {
    const alice = await connectAs('alice');
    const bob = await connectAs('bob');

    const callId = 'call-1';
    alice.emit('call:invite', { callId, calleeId: 'bob', chatId: 'chat-main', callType: 'audio' });

    const incoming = await waitFor(bob, 'call:incoming');
    assert.equal(incoming.callId, callId);
    assert.equal(incoming.callerId, 'alice');
    assert.equal(incoming.chatId, 'chat-main');

    bob.emit('call:accept', { callId });
    const accepted = await waitFor(alice, 'call:accepted');
    assert.equal(accepted.callId, callId);

    alice.emit('call:connected', { callId });
    await new Promise((r) => setTimeout(r, 30)); // let startedAt register before ending

    bob.emit('call:end', { callId });
    const [endedAtAlice, endedAtBob] = await Promise.all([
      waitFor(alice, 'call:ended'),
      waitFor(bob, 'call:ended'),
    ]);
    assert.equal(endedAtAlice.callId, callId);
    assert.equal(endedAtBob.callId, callId);
    assert.ok(endedAtAlice.duration >= 0);

    const row = db.prepare('SELECT status, duration FROM calls WHERE id = ?').get(callId);
    assert.equal(row.status, 'ended');
    assert.ok(row.duration >= 0);

    // activeCalls slot must be freed — a fresh invite between the same pair works again.
    const callId2 = 'call-1b';
    alice.emit('call:invite', { callId: callId2, calleeId: 'bob', chatId: 'chat-main', callType: 'audio' });
    const incoming2 = await waitFor(bob, 'call:incoming');
    assert.equal(incoming2.callId, callId2);

    bob.emit('call:reject', { callId: callId2 });
    const rejected = await waitFor(alice, 'call:rejected');
    assert.equal(rejected.callId, callId2);

    const row2 = db.prepare('SELECT status FROM calls WHERE id = ?').get(callId2);
    assert.equal(row2.status, 'rejected');
  });

  test('missed timeout: server force-ends an unanswered call after CALL_MISSED_TIMEOUT_MS', async () => {
    const carol = await connectAs('carol');
    const dave = await connectAs('dave');

    const callId = 'call-missed';
    carol.emit('call:invite', { callId, calleeId: 'dave', chatId: 'chat-main', callType: 'video' });
    await waitFor(dave, 'call:incoming');

    // Neither side accepts/connects — the server's safety timeout should fire.
    const ended = await waitFor(carol, 'call:ended', 2000);
    assert.equal(ended.callId, callId);
    assert.equal(ended.duration, 0);

    const row = db.prepare('SELECT status, duration FROM calls WHERE id = ?').get(callId);
    assert.equal(row.status, 'missed');
    assert.equal(row.duration, 0);
  });

  test('already_in_call: caller cannot start a second call while one is unresolved', async () => {
    const erin = await connectAs('erin');
    const frank = await connectAs('frank');

    erin.emit('call:invite', { callId: 'call-busy-a', calleeId: 'frank', chatId: 'chat-main', callType: 'audio' });
    await waitFor(frank, 'call:incoming');

    erin.emit('call:invite', { callId: 'call-busy-b', calleeId: 'henry', chatId: 'chat-main', callType: 'audio' });
    const err = await waitFor(erin, 'call:error');
    assert.equal(err.reason, 'already_in_call');

    frank.emit('call:reject', { callId: 'call-busy-a' });
    await waitFor(erin, 'call:rejected');
  });

  test('call:busy: a busy callee rejects a second concurrent inviter', async () => {
    const erin2 = await connectAs('erin2');
    const frank2 = await connectAs('frank2');
    const george = await connectAs('george');

    erin2.emit('call:invite', { callId: 'call-busy-c', calleeId: 'frank2', chatId: 'chat-main', callType: 'audio' });
    await waitFor(frank2, 'call:incoming');

    george.emit('call:invite', { callId: 'call-busy-d', calleeId: 'frank2', chatId: 'chat-main', callType: 'audio' });
    const busy = await waitFor(george, 'call:busy');
    assert.equal(busy.callId, 'call-busy-d');

    frank2.emit('call:reject', { callId: 'call-busy-c' });
    await waitFor(erin2, 'call:rejected');
  });

  test('not_member: rejected when the callee is not a member of the given chat', async () => {
    const alice2 = await connectAs('alice2');

    alice2.emit('call:invite', { callId: 'call-not-member', calleeId: 'ivan', chatId: 'chat-main', callType: 'audio' });
    const err = await waitFor(alice2, 'call:error');
    assert.equal(err.reason, 'not_member');
  });

  test('rate_limited: the 6th invite attempt within the window is rejected', async () => {
    const grace = await connectAs('grace');
    const henry2 = await connectAs('henry2');

    for (let i = 0; i < 5; i++) {
      const callId = `call-rate-${i}`;
      grace.emit('call:invite', { callId, calleeId: 'henry2', chatId: 'chat-main', callType: 'audio' });
      await waitFor(henry2, 'call:incoming');
      henry2.emit('call:reject', { callId });
      await waitFor(grace, 'call:rejected');
    }

    grace.emit('call:invite', { callId: 'call-rate-5', calleeId: 'henry2', chatId: 'chat-main', callType: 'audio' });
    const err = await waitFor(grace, 'call:error');
    assert.equal(err.reason, 'rate_limited');
  });
});
