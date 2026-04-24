'use strict';

/**
 * X5 — Minimal smoke test layer.
 * Covers the four highest-risk scenarios from phases 0-1:
 *   1. Auth error normalization (anti-enumeration)
 *   2. deleteMessages permission checks
 *   3. Upload MIME allowlist
 *   4. search_text sync after editMessage / deleteMessages
 *
 * Uses Node.js built-in `node:test` + `assert` — no extra test framework needed.
 * Database is an in-memory SQLite instance; no real network or file I/O occurs.
 */

// ── Environment must be set before any module loads ──────────────────────────
process.env.MESSAGE_ENCRYPTION_KEY = '0'.repeat(64); // 64 hex chars = 32 bytes
process.env.JWT_SECRET = 'smoke-test-jwt-secret';
process.env.NODE_ENV = 'test';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

// ── In-memory SQLite with minimal schema ─────────────────────────────────────
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password_hash TEXT,
    display_name TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    user_agent TEXT DEFAULT '',
    last_used_at INTEGER,
    ip_address TEXT
  );
  CREATE TABLE chats (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'direct',
    name TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE chat_members (
    chat_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at INTEGER NOT NULL,
    unread_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, user_id)
  );
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    ciphertext TEXT NOT NULL DEFAULT '',
    iv TEXT NOT NULL DEFAULT '',
    auth_tag TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    deleted_at INTEGER,
    attachment_url TEXT,
    attachment_type TEXT,
    attachment_name TEXT,
    attachment_meta TEXT,
    attachment_size INTEGER,
    attachment_duration REAL,
    is_system INTEGER NOT NULL DEFAULT 0,
    liked_by TEXT NOT NULL DEFAULT '[]',
    reactions TEXT NOT NULL DEFAULT '[]',
    is_pinned INTEGER NOT NULL DEFAULT 0,
    forwarded_from_user_id TEXT,
    forwarded_from_username TEXT,
    poll_id TEXT,
    reply_to_id TEXT,
    reply_to_sender_id TEXT,
    reply_to_sender_username TEXT,
    reply_to_ciphertext TEXT,
    reply_to_iv TEXT,
    reply_to_auth_tag TEXT,
    edited_at INTEGER,
    search_text TEXT
  );
  CREATE TABLE message_hidden (
    user_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    PRIMARY KEY (user_id, message_id)
  );
`);

// ── Inject mocks into module cache before services are required ───────────────
function mockModule(relPath, exports) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

mockModule('../src/config/database', { getDb: () => db });
mockModule('../src/config/email', {
  sendOtpEmail: async () => {},
  sendPasswordResetEmail: async () => {},
});
mockModule('../src/utils/s3Delete', { deleteFromS3: () => {} });

// ── Services (loaded after mocks) ────────────────────────────────────────────
const { validatePassword, loginOrRegister } = require('../src/services/authService');
const { deleteMessages, editMessage }       = require('../src/services/messageService');
const { ALLOWED_TYPES }                     = require('../src/utils/allowedMimeTypes');
const { encrypt }                           = require('../src/crypto/aes');

// ── Seed data ────────────────────────────────────────────────────────────────
const NOW = Date.now();
const ALICE_HASH = bcrypt.hashSync('SecurePass1!', 10);

db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?)').run(['alice','alice',null,ALICE_HASH,'Alice',NOW,NOW]);
db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?)').run(['bob',  'bob',  null,null,      'Bob',  NOW,NOW]);
db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?)').run(['carol','carol',null,null,      'Carol',NOW,NOW]);

db.prepare('INSERT INTO chats VALUES (?,?,?,?)').run(['chat-direct','direct',null,    NOW]);
db.prepare('INSERT INTO chats VALUES (?,?,?,?)').run(['chat-group', 'group', 'Test',  NOW]);

db.prepare('INSERT INTO chat_members VALUES (?,?,?,?,?)').run(['chat-direct','alice','member',   NOW,0]);
db.prepare('INSERT INTO chat_members VALUES (?,?,?,?,?)').run(['chat-direct','bob',  'member',   NOW,0]);
db.prepare('INSERT INTO chat_members VALUES (?,?,?,?,?)').run(['chat-group', 'alice','admin',    NOW,0]);
db.prepare('INSERT INTO chat_members VALUES (?,?,?,?,?)').run(['chat-group', 'bob',  'moderator',NOW,0]);
db.prepare('INSERT INTO chat_members VALUES (?,?,?,?,?)').run(['chat-group', 'carol','member',   NOW,0]);

function insertMsg(id, chatId, senderId, text = 'hello') {
  const enc = encrypt(text);
  db.prepare(
    'INSERT INTO messages (id,chat_id,sender_id,ciphertext,iv,auth_tag,created_at,search_text) VALUES (?,?,?,?,?,?,?,?)'
  ).run([id, chatId, senderId, enc.ciphertext, enc.iv, enc.authTag, NOW, text]);
}

// ── 1. validatePassword ───────────────────────────────────────────────────────
describe('validatePassword', () => {
  test('rejects password shorter than 8 chars', () => {
    assert.throws(() => validatePassword('abc1!'), (err) => {
      assert.equal(err.status, 400);
      return true;
    });
  });

  test('rejects password with no digit or special char', () => {
    assert.throws(() => validatePassword('abcdefgh'), (err) => {
      assert.equal(err.status, 400);
      return true;
    });
  });

  test('accepts password with a digit', () => {
    assert.doesNotThrow(() => validatePassword('password1'));
  });

  test('accepts password with a special char', () => {
    assert.doesNotThrow(() => validatePassword('password!'));
  });

  test('accepts password meeting both requirements', () => {
    assert.doesNotThrow(() => validatePassword('Strong1Pass!'));
  });
});

// ── 2. Auth error normalization ───────────────────────────────────────────────
describe('loginOrRegister — auth error normalization', () => {
  test('non-existent user → 401 with generic message', async () => {
    await assert.rejects(
      () => loginOrRegister('nobody', 'SomePass1!'),
      (err) => {
        assert.equal(err.status, 401);
        assert.equal(err.message, 'Неверный логин или пароль');
        return true;
      }
    );
  });

  test('wrong password → 401 with same generic message', async () => {
    await assert.rejects(
      () => loginOrRegister('alice', 'WrongPass1!'),
      (err) => {
        assert.equal(err.status, 401);
        assert.equal(err.message, 'Неверный логин или пароль');
        return true;
      }
    );
  });

  test('error messages are identical regardless of failure cause (anti-enumeration)', async () => {
    let err1, err2;
    try { await loginOrRegister('nobody', 'SomePass1!'); } catch (e) { err1 = e; }
    try { await loginOrRegister('alice',  'WrongPass1!'); } catch (e) { err2 = e; }
    assert.equal(err1?.message, err2?.message, 'error messages must be identical');
    assert.equal(err1?.status,  err2?.status,  'status codes must be identical');
  });
});

// ── 3. deleteMessages — permission checks ────────────────────────────────────
describe('deleteMessages — permission checks', () => {
  test('author can delete own message in direct chat', () => {
    insertMsg('dm-a1', 'chat-direct', 'alice');
    const deleted = deleteMessages('chat-direct', 'alice', ['dm-a1']);
    assert.deepEqual(deleted, ['dm-a1']);
  });

  test('non-author cannot delete others message in direct chat (returns [])', () => {
    insertMsg('dm-a2', 'chat-direct', 'alice');
    const deleted = deleteMessages('chat-direct', 'bob', ['dm-a2']);
    assert.deepEqual(deleted, []);
    const row = db.prepare('SELECT deleted_at FROM messages WHERE id=?').get('dm-a2');
    assert.equal(row.deleted_at, null, 'message must not be soft-deleted');
  });

  test('admin can delete any message in group chat', () => {
    insertMsg('gm-c1', 'chat-group', 'carol');
    const deleted = deleteMessages('chat-group', 'alice', ['gm-c1']);
    assert.deepEqual(deleted, ['gm-c1']);
  });

  test('moderator can delete any message in group chat', () => {
    insertMsg('gm-c2', 'chat-group', 'carol');
    const deleted = deleteMessages('chat-group', 'bob', ['gm-c2']);
    assert.deepEqual(deleted, ['gm-c2']);
  });

  test('regular member cannot delete others message in group chat', () => {
    insertMsg('gm-a1', 'chat-group', 'alice');
    const deleted = deleteMessages('chat-group', 'carol', ['gm-a1']);
    assert.deepEqual(deleted, []);
    const row = db.prepare('SELECT deleted_at FROM messages WHERE id=?').get('gm-a1');
    assert.equal(row.deleted_at, null, 'message must not be soft-deleted');
  });

  test('deleteMessages sets search_text to NULL on deleted message', () => {
    insertMsg('dm-a3', 'chat-direct', 'alice', 'find me');
    deleteMessages('chat-direct', 'alice', ['dm-a3']);
    const row = db.prepare('SELECT search_text FROM messages WHERE id=?').get('dm-a3');
    assert.equal(row.search_text, null, 'search_text must be cleared on delete');
  });
});

// ── 4. search_text sync after edit ───────────────────────────────────────────
describe('editMessage — search_text sync', () => {
  test('search_text is updated to new text after edit', () => {
    insertMsg('edit-1', 'chat-direct', 'alice', 'old text');
    editMessage('chat-direct', 'edit-1', 'alice', 'new text');
    const row = db.prepare('SELECT search_text FROM messages WHERE id=?').get('edit-1');
    assert.equal(row.search_text, 'new text');
  });

  test('old text is no longer in search_text after edit', () => {
    insertMsg('edit-2', 'chat-direct', 'alice', 'original words');
    editMessage('chat-direct', 'edit-2', 'alice', 'completely changed');
    const row = db.prepare('SELECT search_text FROM messages WHERE id=?').get('edit-2');
    assert.notEqual(row.search_text, 'original words');
  });

  test('non-author cannot edit a message', () => {
    insertMsg('edit-3', 'chat-direct', 'alice', 'alice text');
    assert.throws(
      () => editMessage('chat-direct', 'edit-3', 'bob', 'bob override'),
      (err) => {
        assert.equal(err.status, 403);
        return true;
      }
    );
    const row = db.prepare('SELECT search_text FROM messages WHERE id=?').get('edit-3');
    assert.equal(row.search_text, 'alice text', 'search_text must remain unchanged');
  });

  test('edited_at is set after edit', () => {
    insertMsg('edit-4', 'chat-direct', 'alice', 'before edit');
    editMessage('chat-direct', 'edit-4', 'alice', 'after edit');
    const row = db.prepare('SELECT edited_at FROM messages WHERE id=?').get('edit-4');
    assert.ok(row.edited_at > 0, 'edited_at must be a positive timestamp');
  });
});

// ── 5. Upload MIME allowlist ──────────────────────────────────────────────────
describe('upload MIME allowlist', () => {
  const allowed = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'audio/webm', 'audio/mpeg', 'audio/ogg',
    'video/mp4', 'video/webm',
    'application/pdf', 'text/plain', 'application/zip',
    'application/octet-stream',
  ];
  const blocked = [
    'image/svg+xml',
    'text/html',
    'application/javascript',
    'text/javascript',
    'application/x-php',
  ];

  for (const mime of allowed) {
    test(`allows ${mime}`, () => {
      assert.equal(ALLOWED_TYPES.has(mime), true, `${mime} should be allowed`);
    });
  }

  for (const mime of blocked) {
    test(`blocks ${mime}`, () => {
      assert.equal(ALLOWED_TYPES.has(mime), false, `${mime} must be blocked`);
    });
  }
});
