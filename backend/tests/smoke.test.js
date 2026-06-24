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
    avatar_url TEXT,
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
    has_link INTEGER NOT NULL DEFAULT 0
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
  CREATE TABLE chat_daily_prompts (
    chat_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    send_time INTEGER NOT NULL DEFAULT 1260,
    timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
    schedule TEXT NOT NULL DEFAULT '{"type":"daily"}',
    source TEXT NOT NULL DEFAULT '{"banks":["family"],"use_builtin":1,"use_custom":1}',
    order_mode TEXT NOT NULL DEFAULT 'shuffle',
    bag_state TEXT NOT NULL DEFAULT '{}',
    push_enabled INTEGER NOT NULL DEFAULT 1,
    push_text TEXT,
    last_sent_date TEXT,
    updated_by TEXT,
    updated_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE chat_daily_prompt_questions (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    text TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE daily_prompt_instances (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    category TEXT,
    question_key TEXT,
    date_key TEXT NOT NULL,
    message_id TEXT,
    answer_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE daily_prompt_answers (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    ciphertext TEXT NOT NULL DEFAULT '',
    iv TEXT NOT NULL DEFAULT '',
    auth_tag TEXT NOT NULL DEFAULT '',
    attachment_url TEXT,
    attachment_type TEXT,
    attachment_name TEXT,
    attachment_meta TEXT,
    attachment_size INTEGER,
    attachment_duration REAL,
    voice_waveform TEXT,
    created_at INTEGER NOT NULL
  );
`);

db.exec(`
  CREATE TABLE friends (
    user_a_id TEXT NOT NULL, user_b_id TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_a_id, user_b_id)
  );
  CREATE TABLE friend_requests (
    from_user_id TEXT NOT NULL, to_user_id TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (from_user_id, to_user_id)
  );
  CREATE TABLE invite_tokens (
    token TEXT PRIMARY KEY, inviter_id TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
    used_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_used_at INTEGER
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
const { deleteMessages, editMessage, getChatMessages, saveMessage, forwardMessages, searchMessages, toggleReaction, toggleEmojiReaction } = require('../src/services/messageService');
const { ALLOWED_TYPES }                     = require('../src/utils/allowedMimeTypes');
const { encrypt, decrypt }                  = require('../src/crypto/aes');
const { setChatBackground }                 = require('../src/services/chatService');

// ── Seed data ────────────────────────────────────────────────────────────────
const NOW = Date.now();
const ALICE_HASH = bcrypt.hashSync('SecurePass1!', 10);

db.prepare('INSERT INTO users (id,username,email,password_hash,display_name,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?)').run(['alice','alice',null,ALICE_HASH,'Alice',NOW,NOW]);
db.prepare('INSERT INTO users (id,username,email,password_hash,display_name,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?)').run(['bob',  'bob',  null,null,      'Bob',  NOW,NOW]);
db.prepare('INSERT INTO users (id,username,email,password_hash,display_name,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?)').run(['carol','carol',null,null,      'Carol',NOW,NOW]);

db.prepare('INSERT INTO chats (id,type,name,created_at) VALUES (?,?,?,?)').run(['chat-direct','direct',null,    NOW]);
db.prepare('INSERT INTO chats (id,type,name,created_at) VALUES (?,?,?,?)').run(['chat-group', 'group', 'Test',  NOW]);

db.prepare('INSERT INTO chat_members (chat_id,user_id,role,joined_at,unread_count) VALUES (?,?,?,?,?)').run(['chat-direct','alice','member',   NOW,0]);
db.prepare('INSERT INTO chat_members (chat_id,user_id,role,joined_at,unread_count) VALUES (?,?,?,?,?)').run(['chat-direct','bob',  'member',   NOW,0]);
db.prepare('INSERT INTO chat_members (chat_id,user_id,role,joined_at,unread_count) VALUES (?,?,?,?,?)').run(['chat-group', 'alice','admin',    NOW,0]);
db.prepare('INSERT INTO chat_members (chat_id,user_id,role,joined_at,unread_count) VALUES (?,?,?,?,?)').run(['chat-group', 'bob',  'moderator',NOW,0]);
db.prepare('INSERT INTO chat_members (chat_id,user_id,role,joined_at,unread_count) VALUES (?,?,?,?,?)').run(['chat-group', 'carol','member',   NOW,0]);

function insertMsg(id, chatId, senderId, text = 'hello') {
  const enc = encrypt(text);
  const hasLink = /https?:\/\//i.test(text) ? 1 : 0;
  db.prepare(
    'INSERT INTO messages (id,chat_id,sender_id,ciphertext,iv,auth_tag,created_at,has_link) VALUES (?,?,?,?,?,?,?,?)'
  ).run([id, chatId, senderId, enc.ciphertext, enc.iv, enc.authTag, NOW, hasLink]);
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

  test('deleteMessages soft-deletes (sets deleted_at)', () => {
    insertMsg('dm-a3', 'chat-direct', 'alice', 'find me');
    deleteMessages('chat-direct', 'alice', ['dm-a3']);
    const row = db.prepare('SELECT deleted_at FROM messages WHERE id=?').get('dm-a3');
    assert.ok(row.deleted_at > 0, 'message must be soft-deleted');
  });
});

// ── 4. editMessage — re-encrypt without storing plaintext ─────────────────────
describe('editMessage — re-encrypt', () => {
  test('new text is readable only via decryption after edit', () => {
    insertMsg('edit-1', 'chat-direct', 'alice', 'old text');
    editMessage('chat-direct', 'edit-1', 'alice', 'new text');
    const row = db.prepare('SELECT ciphertext, iv, auth_tag FROM messages WHERE id=?').get('edit-1');
    assert.equal(decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }), 'new text');
  });

  test('has_link flag is recomputed on edit', () => {
    insertMsg('edit-2', 'chat-direct', 'alice', 'no link here');
    editMessage('chat-direct', 'edit-2', 'alice', 'now see https://example.com');
    let row = db.prepare('SELECT has_link FROM messages WHERE id=?').get('edit-2');
    assert.equal(row.has_link, 1, 'has_link must be set when text gains a URL');
    editMessage('chat-direct', 'edit-2', 'alice', 'link removed');
    row = db.prepare('SELECT has_link FROM messages WHERE id=?').get('edit-2');
    assert.equal(row.has_link, 0, 'has_link must clear when URL is removed');
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
    const row = db.prepare('SELECT ciphertext, iv, auth_tag FROM messages WHERE id=?').get('edit-3');
    assert.equal(decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }), 'alice text',
      'message must remain unchanged');
  });

  test('edited_at is set after edit', () => {
    insertMsg('edit-4', 'chat-direct', 'alice', 'before edit');
    editMessage('chat-direct', 'edit-4', 'alice', 'after edit');
    const row = db.prepare('SELECT edited_at FROM messages WHERE id=?').get('edit-4');
    assert.ok(row.edited_at > 0, 'edited_at must be a positive timestamp');
  });
});

// ── 4b. Searchable encryption — NO plaintext at rest ──────────────────────────
describe('searchable encryption (no plaintext at rest)', () => {
  test('saveMessage stores no readable copy of the text in any column', () => {
    const secret = 'pineapple-on-pizza-7531';
    saveMessage('chat-direct', 'alice', secret);
    // Scan every column of every row — the phrase must appear nowhere as cleartext.
    const rows = db.prepare('SELECT * FROM messages').all();
    const leaked = rows.some(r =>
      Object.values(r).some(v => typeof v === 'string' && v.includes(secret))
    );
    assert.equal(leaked, false, 'plaintext must never be persisted');
  });

  test('searchMessages finds a message by substring via in-memory decryption', () => {
    saveMessage('chat-direct', 'alice', 'meet me at the riverside cafe');
    const hits = searchMessages('alice', 'riverside');
    assert.ok(hits.some(h => h.text === 'meet me at the riverside cafe'),
      'substring search must locate the decrypted message');
  });

  test('searchMessages does not return messages from chats the user is not in', () => {
    saveMessage('chat-group', 'alice', 'groupsecret-marker');
    // bob is a member of chat-group, carol is too; dave is not a member of anything
    const hits = searchMessages('dave', 'groupsecret-marker');
    assert.equal(hits.length, 0, 'non-members must not see chat content');
  });

  test('saveMessage sets has_link when text contains a URL', () => {
    const msg = saveMessage('chat-direct', 'alice', 'check https://blizkie.app');
    const row = db.prepare('SELECT has_link FROM messages WHERE id=?').get(msg.id);
    assert.equal(row.has_link, 1);
  });
});

// ── 4c. TOTP secret encryption at rest (audit #3) ─────────────────────────────
describe('TOTP secret encryption at rest', () => {
  const {
    generateSecret, encryptSecret, decryptSecret, isEncryptedSecret,
    verifyToken, verifyTotp,
  } = require('../src/utils/totp');

  test('round-trips a secret and marks it as encrypted', () => {
    const secret = generateSecret();
    const stored = encryptSecret(secret);
    assert.equal(isEncryptedSecret(stored), true, 'stored value must carry the encryption marker');
    assert.equal(stored.includes(secret), false, 'plaintext secret must not appear in the stored value');
    assert.equal(decryptSecret(stored), secret, 'decrypt must recover the original secret');
  });

  test('legacy plaintext secrets pass through decrypt unchanged', () => {
    const legacy = generateSecret(); // unmarked base32, as old rows stored it
    assert.equal(isEncryptedSecret(legacy), false);
    assert.equal(decryptSecret(legacy), legacy, 'legacy value must be returned as-is');
  });

  test('verifyTotp behaves identically on encrypted and legacy secrets', () => {
    const secret = generateSecret();
    const token = '000000';
    assert.equal(verifyTotp(encryptSecret(secret), token), verifyToken(secret, token),
      'encrypted secret must verify the same as plaintext');
    assert.equal(verifyTotp(secret, token), verifyToken(secret, token),
      'legacy plaintext must still verify');
  });

  test('verifyTotp returns false for empty/garbage secret', () => {
    assert.equal(verifyTotp(null, '123456'), false);
    assert.equal(verifyTotp('enc:v1:bad:data:here', '123456'), false);
  });
});

// ── 4c2. Reactions are scoped to the message's chat (audit #5) ────────────────
describe('reactions — cross-chat IDOR guard', () => {
  test('member can react to a message in their own chat', () => {
    insertMsg('rx-1', 'chat-direct', 'alice', 'hi');
    const liked = toggleReaction('chat-direct', 'rx-1', 'bob');
    assert.deepEqual(liked, ['bob']);
  });

  test('like reaction with a mismatched chatId is rejected (404)', () => {
    insertMsg('rx-2', 'chat-direct', 'alice', 'secret in DM');
    // carol is a member of chat-group but NOT of chat-direct; she guesses rx-2's id
    assert.throws(
      () => toggleReaction('chat-group', 'rx-2', 'carol'),
      (err) => { assert.equal(err.status, 404); return true; },
    );
    // the message in its real chat is untouched
    const row = db.prepare('SELECT liked_by FROM messages WHERE id=?').get('rx-2');
    assert.equal(row.liked_by ?? '[]', '[]');
  });

  test('emoji reaction with a mismatched chatId is rejected (404)', () => {
    insertMsg('rx-3', 'chat-direct', 'alice', 'another DM');
    assert.throws(
      () => toggleEmojiReaction('chat-group', 'rx-3', 'carol', '👍'),
      (err) => { assert.equal(err.status, 404); return true; },
    );
  });

  test('emoji reaction works when chatId matches', () => {
    insertMsg('rx-4', 'chat-group', 'alice', 'group msg');
    const reactions = toggleEmojiReaction('chat-group', 'rx-4', 'carol', '🔥');
    assert.ok(reactions.some(r => r.userId === 'carol' && r.emoji === '🔥'));
  });
});

// ── 4d. Admin token expiry (audit #4) ─────────────────────────────────────────
describe('jwt — admin token expiry', () => {
  const { sign, verify } = require('../src/utils/jwt');

  test('admin token is signed with a future exp claim', () => {
    const payload = verify(sign({ sub: 'admin', jti: 'sess-1' }, { expiresIn: '12h' }));
    assert.ok(payload.exp, 'exp claim must be present');
    assert.ok(payload.exp * 1000 > Date.now(), 'exp must be in the future');
  });

  test('an expired admin token is rejected by verify()', () => {
    const expired = sign({ sub: 'admin', jti: 'sess-2' }, { expiresIn: '-1s' });
    assert.throws(() => verify(expired));
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

// ── 7. DB backup encryption (audit #2) ────────────────────────────────────────
describe('backupCrypto — encrypted DB backups', () => {
  const { encryptBackup, decryptBackup, isEncryptedBackup, MAGIC } =
    require('../src/utils/backupCrypto');

  test('round-trips an arbitrary payload', () => {
    const plain = Buffer.from('SQLite format 3 …secret message data…', 'utf8');
    const enc = encryptBackup(plain);
    assert.ok(decryptBackup(enc).equals(plain), 'decrypt(encrypt(x)) must equal x');
  });

  test('ciphertext does not contain the plaintext and carries the magic header', () => {
    const secret = 'totally-secret-db-bytes';
    const enc = encryptBackup(Buffer.from(secret, 'utf8'));
    assert.equal(enc.subarray(0, MAGIC.length).equals(MAGIC), true, 'magic header present');
    assert.equal(isEncryptedBackup(enc), true);
    assert.equal(enc.includes(Buffer.from(secret, 'utf8')), false, 'plaintext must not leak into the blob');
  });

  test('tampering with the ciphertext is detected (GCM auth fails)', () => {
    const enc = encryptBackup(Buffer.from('important', 'utf8'));
    enc[enc.length - 1] ^= 0xff; // flip a byte in the ciphertext
    assert.throws(() => decryptBackup(enc));
  });

  test('a non-encrypted buffer is rejected (bad magic)', () => {
    assert.throws(() => decryptBackup(Buffer.from('plain sqlite bytes')), /magic/i);
    assert.equal(isEncryptedBackup(Buffer.from('plain')), false);
  });

  test('a dedicated DB_BACKUP_ENCRYPTION_KEY is used when set', () => {
    const prev = process.env.DB_BACKUP_ENCRYPTION_KEY;
    process.env.DB_BACKUP_ENCRYPTION_KEY = 'a'.repeat(64);
    const enc = encryptBackup(Buffer.from('x'));
    assert.ok(decryptBackup(enc).equals(Buffer.from('x')));
    // With the dedicated key removed, the derived key differs → cannot decrypt.
    delete process.env.DB_BACKUP_ENCRYPTION_KEY;
    assert.throws(() => decryptBackup(enc));
    if (prev !== undefined) process.env.DB_BACKUP_ENCRYPTION_KEY = prev;
  });
});

// ── Daily Prompt («Вопрос дня») ───────────────────────────────────────────────
describe('daily prompt — config, delivery, answers, streak', () => {
  const dp = require('../src/services/dailyPromptService');

  test('helpers: prevDateKey / weekdayOf / isScheduledDay', () => {
    assert.equal(dp.prevDateKey('2026-03-01'), '2026-02-28');
    assert.equal(dp.prevDateKey('2026-01-01'), '2025-12-31');
    // 2026-06-22 is a Monday (weekday 1)
    assert.equal(dp.weekdayOf('2026-06-22'), 1);
    assert.equal(dp.isScheduledDay({ type: 'daily' }, '2026-06-22'), true);
    assert.equal(dp.isScheduledDay({ type: 'weekdays' }, '2026-06-22'), true);  // Mon
    assert.equal(dp.isScheduledDay({ type: 'weekdays' }, '2026-06-21'), false); // Sun
    assert.equal(dp.isScheduledDay({ type: 'weekly', days: [1] }, '2026-06-22'), true);
    assert.equal(dp.isScheduledDay({ type: 'weekly', days: [3] }, '2026-06-22'), false);
  });

  test('non-member cannot read config/status', () => {
    assert.throws(() => dp.getStatus('chat-group', 'stranger'), (e) => e.status === 403);
  });

  test('member without edit_info cannot manage; admin/direct can', () => {
    // carol is a plain member of chat-group
    assert.throws(() => dp.updateConfig('chat-group', 'carol', { enabled: true }), (e) => e.status === 403);
    // alice is admin of chat-group
    const cfg = dp.updateConfig('chat-group', 'alice', { enabled: true, send_time: 600 });
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.send_time, 600);
    // both parties manage a direct chat
    assert.doesNotThrow(() => dp.updateConfig('chat-direct', 'bob', { enabled: true }));
  });

  test('invalid timezone falls back to default', () => {
    const cfg = dp.updateConfig('chat-group', 'alice', { timezone: 'Not/AReal_Zone' });
    assert.equal(cfg.timezone, 'Europe/Moscow');
  });

  test('custom questions: add (manage only) / list / delete', () => {
    assert.throws(() => dp.addCustomQuestion('chat-group', 'carol', 'hi'), (e) => e.status === 403);
    const q = dp.addCustomQuestion('chat-group', 'alice', '  Любимое блюдо?  ');
    assert.equal(q.text, 'Любимое блюдо?');
    const list = dp.listCustomQuestions('chat-group', 'carol'); // any member can read
    assert.ok(list.some(x => x.id === q.id));
    dp.deleteCustomQuestion('chat-group', 'alice', q.id);
    assert.ok(!dp.listCustomQuestions('chat-group', 'alice').some(x => x.id === q.id));
  });

  test('askNow creates an instance + feed card with daily_prompt meta', () => {
    const { message, members } = dp.askNow('chat-group', 'alice');
    assert.equal(message.attachment_type, 'daily_prompt');
    assert.ok(message.daily_prompt.instance_id);
    assert.equal(message.daily_prompt.answer_count, 0);
    assert.ok(members.length >= 1);
    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(message.id);
    assert.equal(row.attachment_type, 'daily_prompt');
    assert.ok(row.ciphertext && row.ciphertext.length > 0);
    // question text is NOT stored in plaintext on the instance row
    const inst = db.prepare('SELECT * FROM daily_prompt_instances WHERE id = ?').get(message.daily_prompt.instance_id);
    assert.equal(inst.chat_id, 'chat-group');
    assert.ok(!String(inst.ciphertext).includes(message.text));
  });

  test('deliverDueDailyPrompts fires when due and is idempotent per day', () => {
    db.prepare('INSERT INTO chats (id,type,name,created_at) VALUES (?,?,?,?)').run(['chat-dp','group','DP',NOW]);
    db.prepare('INSERT INTO chat_members (chat_id,user_id,role,joined_at,unread_count) VALUES (?,?,?,?,?)').run(['chat-dp','alice','admin',NOW,0]);
    db.prepare('INSERT INTO chat_members (chat_id,user_id,role,joined_at,unread_count) VALUES (?,?,?,?,?)').run(['chat-dp','bob','member',NOW,0]);
    dp.updateConfig('chat-dp', 'alice', { enabled: true, send_time: 0, schedule: { type: 'daily' } });

    const first = dp.deliverDueDailyPrompts().filter(r => r.message.chat_id === 'chat-dp');
    assert.equal(first.length, 1);
    const second = dp.deliverDueDailyPrompts().filter(r => r.message.chat_id === 'chat-dp');
    assert.equal(second.length, 0);
  });

  test('answers: text + media, count increments, non-member blocked, only own can delete', () => {
    const { message } = dp.askNow('chat-dp', 'alice');
    const instanceId = message.daily_prompt.instance_id;

    assert.throws(() => dp.addAnswer('chat-dp', 'stranger', instanceId, { text: 'x' }), (e) => e.status === 403);
    assert.throws(() => dp.addAnswer('chat-dp', 'alice', instanceId, {}), (e) => e.status === 400);

    const a1 = dp.addAnswer('chat-dp', 'alice', instanceId, { text: 'Текстовый ответ' });
    assert.equal(a1.answer_count, 1);
    const a2 = dp.addAnswer('chat-dp', 'bob', instanceId, {
      text: '', attachment: { attachment_url: 's3://x/voice.webm', attachment_type: 'audio', voice_waveform: '[1,2,3]' },
    });
    assert.equal(a2.answer_count, 2);

    const thread = dp.getInstanceThread('chat-dp', 'bob', instanceId);
    assert.equal(thread.answers.length, 2);
    assert.equal(thread.answers[0].text, 'Текстовый ответ');
    assert.equal(thread.answers[1].attachment_type, 'audio');

    assert.throws(() => dp.deleteAnswer('chat-dp', 'bob', a1.answer.id), (e) => e.status === 403);
    const del = dp.deleteAnswer('chat-dp', 'alice', a1.answer.id);
    assert.equal(del.answer_count, 1);
  });

  test('computeStreak counts consecutive answered days; pending today does not reset', () => {
    db.prepare('INSERT INTO chats (id,type,name,created_at) VALUES (?,?,?,?)').run(['chat-streak','group','S',NOW]);
    const enc = encrypt('q');
    let i = 0;
    const mk = (dateKey, answers) => {
      const id = 'inst-' + dateKey + '-' + (i++);
      db.prepare('INSERT INTO daily_prompt_instances (id,chat_id,ciphertext,iv,auth_tag,date_key,answer_count,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run([id, 'chat-streak', enc.ciphertext, enc.iv, enc.authTag, dateKey, answers, NOW + i]);
    };
    mk('2026-06-20', 1);
    mk('2026-06-21', 1);
    mk('2026-06-22', 0); // today, pending → skipped, not a reset
    assert.equal(dp.computeStreak(db, 'chat-streak'), 2);
  });

  test('pickNext shuffle exhausts bag without repeats within a cycle', () => {
    const pool = [{ key: 'a', text: 'A' }, { key: 'b', text: 'B' }, { key: 'c', text: 'C' }];
    let bag = {};
    const seen = new Set();
    for (let n = 0; n < 3; n++) {
      const r = dp.pickNext({ order_mode: 'shuffle', bag_state: JSON.stringify(bag) }, pool);
      seen.add(r.picked.key); bag = r.newBag;
    }
    assert.equal(seen.size, 3);
  });
});

// ── Invite tokens (этап B) ────────────────────────────────────────────────────
describe('invite tokens (этап B)', () => {
  const inv = require('../src/services/inviteService');

  test('getOrCreateMyToken стабилен; regenerate отзывает старую', () => {
    const t1 = inv.getOrCreateMyToken('alice');
    const t2 = inv.getOrCreateMyToken('alice');
    assert.equal(t1.token, t2.token);
    const t3 = inv.regenerateMyToken('alice');
    assert.notEqual(t3.token, t1.token);
    assert.equal(inv.getOrCreateMyToken('alice').token, t3.token);
  });

  test('resolveToken возвращает пригласившего; невалидный → 404', () => {
    const { token } = inv.getOrCreateMyToken('bob');
    assert.equal(inv.resolveToken(token).inviter.id, 'bob');
    assert.throws(() => inv.resolveToken('nope'), (e) => e.status === 404);
  });

  test('acceptToken: self → {self}; иначе друзья + чат + used_count++', () => {
    const { token } = inv.getOrCreateMyToken('carol');
    assert.deepEqual(inv.acceptToken(token, 'carol'), { self: true });

    const res = inv.acceptToken(token, 'alice');
    assert.ok(res.chatId);
    assert.equal(res.inviterId, 'carol');

    const fr = db.prepare(
      'SELECT 1 FROM friends WHERE (user_a_id=? AND user_b_id=?) OR (user_a_id=? AND user_b_id=?)'
    ).get(['alice', 'carol', 'carol', 'alice']);
    assert.ok(fr);

    assert.equal(db.prepare('SELECT used_count FROM invite_tokens WHERE token=?').get(token).used_count, 1);

    const res2 = inv.acceptToken(token, 'alice');
    assert.equal(res2.chatId, res.chatId); // тот же ЛС
  });

  test('acceptToken: заблокирован → 403', () => {
    db.prepare('INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id) VALUES (?, ?)').run(['bob', 'alice']);
    const { token } = inv.getOrCreateMyToken('bob');
    assert.throws(() => inv.acceptToken(token, 'alice'), (e) => e.status === 403);
  });
});

// ── Auto-seed «Избранного» (этап A) ───────────────────────────────────────────
describe('saved chat welcome seed', () => {
  const { seedSavedWelcome } = require('../src/services/chat/create');

  test('seedSavedWelcome вставляет приветственные сообщения (не системные, расшифровываются, с deep-link)', () => {
    seedSavedWelcome(db, 'chat-saved-seed', 'alice', NOW);
    const rows = db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC').all('chat-saved-seed');
    assert.ok(rows.length >= 3);
    assert.ok(rows.every(r => r.is_system === 0 && r.sender_id === 'alice' && r.is_delivered === 1));
    const texts = rows.map(r => decrypt({ ciphertext: r.ciphertext, iv: r.iv, authTag: r.auth_tag }));
    assert.ok(texts.some(t => t.includes('Избранное')));
    assert.ok(texts.some(t => t.includes('blz:invite')));
  });
});

// ── Ассистент-помощник: LLM-маршрутизатор (этап C, v2) ────────────────────────
describe('assistant LLM router', () => {
  const intents = [
    { id: 'invite', question: 'Как пригласить близких?' },
    { id: 'calls', question: 'Как позвонить?' },
  ];

  function withEnv(env, fn) {
    const saved = {};
    for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
    try { return fn(); } finally {
      for (const k of Object.keys(env)) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
      }
    }
  }

  function fresh() {
    delete require.cache[require.resolve('../src/services/assistantService')];
    return require('../src/services/assistantService');
  }

  test('isEnabled() = false без env', () => {
    withEnv({ AI_ASSISTANT_ENABLED: '', AI_SUMMARY_ENABLED: '', AI_ASSISTANT_API_KEY: '', AI_SUMMARY_API_KEY: '' }, () => {
      assert.equal(fresh().isEnabled(), false);
    });
  });

  test('routeQuestion бросает 503 когда выключено', async () => {
    await withEnv({ AI_ASSISTANT_ENABLED: '', AI_SUMMARY_ENABLED: '', AI_ASSISTANT_API_KEY: '', AI_SUMMARY_API_KEY: '' }, async () => {
      await assert.rejects(() => fresh().routeQuestion('как позвонить', intents), (e) => e.status === 503);
    });
  });

  test('routeQuestion возвращает валидный id из каталога', async () => {
    await withEnv({ AI_ASSISTANT_ENABLED: 'true', AI_ASSISTANT_API_KEY: 'k' }, async () => {
      const origFetch = global.fetch;
      global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"id":"calls"}' } }] }) });
      try {
        const r = await fresh().routeQuestion('наберу маму', intents);
        assert.equal(r.intentId, 'calls');
      } finally { global.fetch = origFetch; }
    });
  });

  test('routeQuestion отбрасывает id не из каталога → null', async () => {
    await withEnv({ AI_ASSISTANT_ENABLED: 'true', AI_ASSISTANT_API_KEY: 'k' }, async () => {
      const origFetch = global.fetch;
      global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"id":"nonexistent"}' } }] }) });
      try {
        const r = await fresh().routeQuestion('бла бла', intents);
        assert.equal(r.intentId, null);
      } finally { global.fetch = origFetch; }
    });
  });

  test('routeQuestion с пустым каталогом → null (без вызова LLM)', async () => {
    await withEnv({ AI_ASSISTANT_ENABLED: 'true', AI_ASSISTANT_API_KEY: 'k' }, async () => {
      const r = await fresh().routeQuestion('вопрос', []);
      assert.equal(r.intentId, null);
    });
  });
});
