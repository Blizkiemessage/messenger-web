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
    created_at INTEGER NOT NULL,
    description TEXT,
    avatar_url TEXT,
    creator_id TEXT,
    is_closed INTEGER NOT NULL DEFAULT 0,
    chat_bg TEXT,
    chat_bg_updated_at INTEGER
  );
  CREATE TABLE chat_backgrounds (
    user_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    bg TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, chat_id)
  );
  CREATE TABLE chat_members (
    chat_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at INTEGER NOT NULL,
    unread_count INTEGER NOT NULL DEFAULT 0,
    permissions TEXT,
    last_read_at INTEGER NOT NULL DEFAULT 0,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    pin_order INTEGER,
    is_muted INTEGER NOT NULL DEFAULT 0,
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
    voice_waveform TEXT,
    deliver_at INTEGER,
    is_delivered INTEGER NOT NULL DEFAULT 1,
    search_text TEXT
  );
  CREATE TABLE message_hidden (
    user_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    PRIMARY KEY (user_id, message_id)
  );
  CREATE TABLE contact_aliases (
    user_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    alias TEXT,
    PRIMARY KEY (user_id, target_id)
  );
  CREATE TABLE blocked_users (
    blocker_id TEXT NOT NULL,
    blocked_id TEXT NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id)
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
const { deleteMessages, editMessage, getChatMessages, saveMessage, forwardMessages } = require('../src/services/messageService');
const { ALLOWED_TYPES }                     = require('../src/utils/allowedMimeTypes');
const { encrypt }                           = require('../src/crypto/aes');
const { setChatBackground }                 = require('../src/services/chatService');

// ── Seed data ────────────────────────────────────────────────────────────────
const NOW = Date.now();
const ALICE_HASH = bcrypt.hashSync('SecurePass1!', 10);

db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?)').run(['alice','alice',null,ALICE_HASH,'Alice',NOW,NOW]);
db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?)').run(['bob',  'bob',  null,null,      'Bob',  NOW,NOW]);
db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?)').run(['carol','carol',null,null,      'Carol',NOW,NOW]);

db.prepare('INSERT INTO chats (id,type,name,created_at) VALUES (?,?,?,?)').run(['chat-direct','direct',null,    NOW]);
db.prepare('INSERT INTO chats (id,type,name,created_at) VALUES (?,?,?,?)').run(['chat-group', 'group', 'Test',  NOW]);

db.prepare('INSERT INTO chat_members (chat_id,user_id,role,joined_at,unread_count) VALUES (?,?,?,?,?)').run(['chat-direct','alice','member',   NOW,0]);
db.prepare('INSERT INTO chat_members (chat_id,user_id,role,joined_at,unread_count) VALUES (?,?,?,?,?)').run(['chat-direct','bob',  'member',   NOW,0]);
db.prepare('INSERT INTO chat_members (chat_id,user_id,role,joined_at,unread_count) VALUES (?,?,?,?,?)').run(['chat-group', 'alice','admin',    NOW,0]);
db.prepare('INSERT INTO chat_members (chat_id,user_id,role,joined_at,unread_count) VALUES (?,?,?,?,?)').run(['chat-group', 'bob',  'moderator',NOW,0]);
db.prepare('INSERT INTO chat_members (chat_id,user_id,role,joined_at,unread_count) VALUES (?,?,?,?,?)').run(['chat-group', 'carol','member',   NOW,0]);

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

// ── 5. app_bg: сохранение и валидация пользовательского фона ────────────────
describe('app_bg persistence & validation', () => {
  // Тестовая схема users минимальна — добиваем колонки внешнего вида
  db.exec(`
    ALTER TABLE users ADD COLUMN app_bg TEXT;
    ALTER TABLE users ADD COLUMN theme TEXT;
    ALTER TABLE users ADD COLUMN accent_color TEXT;
  `);
  const { updateUser } = require('../src/services/userService');

  const uid = 'user-appbg-test';
  db.prepare(
    "INSERT INTO users (id, username, display_name, created_at, last_seen_at) VALUES (?, ?, '', 0, 0)"
  ).run(uid, 'appbg_tester');

  test('saves a valid app_bg JSON string', () => {
    const json = JSON.stringify({ type: 'gradient', c1: '#2d1b4e', c2: '#7c2d5e', angle: 160 });
    const updated = updateUser(uid, { app_bg: json });
    assert.equal(updated.app_bg, json);
  });

  test('clears app_bg with null (reset to default)', () => {
    const updated = updateUser(uid, { app_bg: null });
    assert.equal(updated.app_bg, null);
  });

  test('rejects non-string app_bg', () => {
    assert.throws(() => updateUser(uid, { app_bg: { type: 'solid' } }), /Invalid app_bg/);
  });

  test('rejects oversized app_bg (>500 chars)', () => {
    assert.throws(() => updateUser(uid, { app_bg: 'x'.repeat(501) }), /Invalid app_bg/);
  });

  test('undefined app_bg leaves stored value untouched', () => {
    const json = JSON.stringify({ type: 'solid', c1: '#101418' });
    updateUser(uid, { app_bg: json });
    const updated = updateUser(uid, { display_name: 'Тестер' });
    assert.equal(updated.app_bg, json);
  });
});

// ── 6. csrfOrigin: блокировка кросс-доменных мутаций ───────────────────────
describe('csrfOrigin middleware', () => {
  process.env.APP_URL = 'https://app.blizkie.ru';
  const { csrfOrigin } = require('../src/middleware/csrfOrigin');

  function run(method, headers) {
    const req = { method, headers };
    let status = 200, body = null, nexted = false;
    const res = {
      status(s) { status = s; return this; },
      json(b) { body = b; return this; },
    };
    csrfOrigin(req, res, () => { nexted = true; });
    return { status, body, nexted };
  }

  test('allows safe GET regardless of origin', () => {
    const r = run('GET', { origin: 'https://evil.com', host: 'api.blizkie.ru' });
    assert.equal(r.nexted, true);
  });

  test('allows same-origin POST', () => {
    const r = run('POST', { origin: 'https://api.blizkie.ru', host: 'api.blizkie.ru' });
    assert.equal(r.nexted, true);
  });

  test('allows POST from allowlisted APP_URL', () => {
    const r = run('POST', { origin: 'https://app.blizkie.ru', host: 'api.blizkie.ru' });
    assert.equal(r.nexted, true);
  });

  test('allows POST with no Origin/Referer (non-browser client)', () => {
    const r = run('POST', { host: 'api.blizkie.ru' });
    assert.equal(r.nexted, true);
  });

  test('blocks cross-origin POST from a foreign site', () => {
    const r = run('POST', { origin: 'https://evil.com', host: 'api.blizkie.ru' });
    assert.equal(r.nexted, false);
    assert.equal(r.status, 403);
    assert.match(r.body.error, /Cross-origin/);
  });

  test('falls back to Referer when Origin is absent', () => {
    const r = run('DELETE', { referer: 'https://evil.com/page', host: 'api.blizkie.ru' });
    assert.equal(r.status, 403);
  });
});

// ── 7. Access control — chat membership (core privacy guarantee) ───────────
// Самое важное для приватного мессенджера: посторонний не читает чужой чат
// и не пишет в него. carol НЕ состоит в chat-direct (там только alice+bob).
describe('access control — chat membership', () => {
  insertMsg('ac-msg-1', 'chat-direct', 'alice', 'секрет для bob');

  test('member can read chat history', () => {
    const msgs = getChatMessages('chat-direct', 'bob', { limit: 50 });
    assert.ok(msgs.some(m => m.text === 'секрет для bob'));
  });

  test('non-member CANNOT read chat history (403)', () => {
    assert.throws(
      () => getChatMessages('chat-direct', 'carol', { limit: 50 }),
      (err) => { assert.equal(err.status, 403); return true; },
    );
  });

  test('non-member CANNOT post a message (403)', () => {
    assert.throws(
      () => saveMessage('chat-direct', 'carol', 'я чужой'),
      (err) => { assert.equal(err.status, 403); return true; },
    );
  });

  test('member can post a message', () => {
    const msg = saveMessage('chat-direct', 'alice', 'привет bob');
    assert.equal(msg.text, 'привет bob');
  });

  test('cannot forward INTO a chat you are not a member of (403)', () => {
    assert.throws(
      () => forwardMessages('chat-direct', 'carol', ['ac-msg-1']),
      (err) => { assert.equal(err.status, 403); return true; },
    );
  });

  test('member can forward into their own chat', () => {
    // bob состоит и в chat-direct, и в chat-group → может переслать туда
    const res = forwardMessages('chat-group', 'bob', ['ac-msg-1']);
    assert.equal(res.length, 1);
  });
});

// ── 8. Гранулярные права модератора ────────────────────────────────────────
describe('moderator granular permissions', () => {
  const { getMemberPermissions } = require('../src/services/chatPermissions');

  test('admin has all permissions', () => {
    const p = getMemberPermissions(db, 'chat-group', 'alice');
    assert.deepEqual(p, { role: 'admin', edit_info: true, delete_messages: true, manage_members: true });
  });

  test('plain member has no permissions', () => {
    const p = getMemberPermissions(db, 'chat-group', 'carol');
    assert.equal(p.edit_info, false);
    assert.equal(p.delete_messages, false);
    assert.equal(p.manage_members, false);
  });

  test('moderator default perms preserve legacy behavior (delete + manage, no edit_info)', () => {
    // bob is moderator with NULL permissions
    const p = getMemberPermissions(db, 'chat-group', 'bob');
    assert.equal(p.role, 'moderator');
    assert.equal(p.edit_info, false);
    assert.equal(p.delete_messages, true);
    assert.equal(p.manage_members, true);
  });

  test('explicit permissions JSON is respected', () => {
    db.prepare("UPDATE chat_members SET permissions = ? WHERE chat_id = 'chat-group' AND user_id = 'bob'")
      .run(JSON.stringify({ edit_info: true, delete_messages: false, manage_members: false }));
    const p = getMemberPermissions(db, 'chat-group', 'bob');
    assert.equal(p.edit_info, true);
    assert.equal(p.delete_messages, false);
    assert.equal(p.manage_members, false);
    // reset
    db.prepare("UPDATE chat_members SET permissions = NULL WHERE chat_id = 'chat-group' AND user_id = 'bob'").run();
  });

  test('moderator WITHOUT delete_messages cannot delete others messages', () => {
    insertMsg('perm-msg-1', 'chat-group', 'carol', 'сообщение carol');
    db.prepare("UPDATE chat_members SET permissions = ? WHERE chat_id = 'chat-group' AND user_id = 'bob'")
      .run(JSON.stringify({ edit_info: false, delete_messages: false, manage_members: true }));
    const deleted = deleteMessages('chat-group', 'bob', ['perm-msg-1']);
    assert.equal(deleted.length, 0, 'moderator without delete_messages must not delete');
    db.prepare("UPDATE chat_members SET permissions = NULL WHERE chat_id = 'chat-group' AND user_id = 'bob'").run();
  });

  test('moderator WITH delete_messages (default) can delete others messages', () => {
    insertMsg('perm-msg-2', 'chat-group', 'carol', 'ещё сообщение carol');
    const deleted = deleteMessages('chat-group', 'bob', ['perm-msg-2']);
    assert.equal(deleted.length, 1);
  });
});

// ── 9. Фоны чата (личный / общий) ──────────────────────────────────────────
describe('chat backgrounds', () => {
  const grad = { type: 'gradient', c1: '#2d1b4e', c2: '#7c2d5e', angle: 160 };

  test('personal background: any member can set their own', () => {
    setChatBackground('chat-group', 'carol', { type: 'solid', c1: '#101418' }, false);
    const row = db.prepare("SELECT bg FROM chat_backgrounds WHERE user_id='carol' AND chat_id='chat-group'").get();
    assert.ok(row && JSON.parse(row.bg).type === 'solid');
  });

  test('non-member cannot set background (403)', () => {
    // alice/bob are in chat-direct, carol is NOT
    assert.throws(
      () => setChatBackground('chat-direct', 'carol', grad, false),
      (err) => { assert.equal(err.status, 403); return true; },
    );
  });

  test('shared background in DM: any participant can set', () => {
    setChatBackground('chat-direct', 'bob', grad, true);
    const row = db.prepare("SELECT chat_bg FROM chats WHERE id='chat-direct'").get();
    assert.ok(row.chat_bg && JSON.parse(row.chat_bg).type === 'gradient');
  });

  test('shared background in group: admin (edit_info) can set', () => {
    setChatBackground('chat-group', 'alice', grad, true);
    const row = db.prepare("SELECT chat_bg FROM chats WHERE id='chat-group'").get();
    assert.ok(JSON.parse(row.chat_bg).type === 'gradient');
  });

  test('shared background in group: moderator WITHOUT edit_info is rejected (403)', () => {
    // bob is moderator with default perms → edit_info=false
    assert.throws(
      () => setChatBackground('chat-group', 'bob', { type: 'solid', c1: '#000000' }, true),
      (err) => { assert.equal(err.status, 403); return true; },
    );
  });

  test('shared background in group: moderator WITH edit_info can set', () => {
    db.prepare("UPDATE chat_members SET permissions=? WHERE chat_id='chat-group' AND user_id='bob'")
      .run(JSON.stringify({ edit_info: true, delete_messages: true, manage_members: true }));
    setChatBackground('chat-group', 'bob', { type: 'solid', c1: '#222222' }, true);
    const row = db.prepare("SELECT chat_bg FROM chats WHERE id='chat-group'").get();
    assert.equal(JSON.parse(row.chat_bg).c1, '#222222');
    db.prepare("UPDATE chat_members SET permissions=NULL WHERE chat_id='chat-group' AND user_id='bob'").run();
  });

  test('invalid background payload is rejected (400)', () => {
    assert.throws(
      () => setChatBackground('chat-group', 'alice', { type: 'bogus' }, true),
      (err) => { assert.equal(err.status, 400); return true; },
    );
  });

  test('clearing personal background removes the row', () => {
    setChatBackground('chat-group', 'carol', null, false);
    const row = db.prepare("SELECT bg FROM chat_backgrounds WHERE user_id='carol' AND chat_id='chat-group'").get();
    assert.equal(row, undefined);
  });

  test('shared background "for everyone" clears the author\'s own personal bg', () => {
    // alice (admin) сначала ставит личный фон, затем делает фон общим «для всех»
    setChatBackground('chat-group', 'alice', { type: 'solid', c1: '#123456' }, false);
    assert.ok(db.prepare("SELECT bg FROM chat_backgrounds WHERE user_id='alice' AND chat_id='chat-group'").get());
    setChatBackground('chat-group', 'alice', { type: 'solid', c1: '#654321' }, true);
    // личный фон автора снят — общий фон теперь виден и ему
    const personal = db.prepare("SELECT bg FROM chat_backgrounds WHERE user_id='alice' AND chat_id='chat-group'").get();
    assert.equal(personal, undefined);
  });

  test('shared background "for everyone" stamps chat_bg_updated_at', () => {
    const before = Date.now() - 1;
    setChatBackground('chat-direct', 'bob', { type: 'solid', c1: '#abcdef' }, true);
    const row = db.prepare("SELECT chat_bg_updated_at FROM chats WHERE id='chat-direct'").get();
    assert.ok(row.chat_bg_updated_at >= before, 'chat_bg_updated_at должен проставляться');
  });
});
