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
// Matches production (config/database.js sets this too) — off by default in
// better-sqlite3, so without it FK-constraint bugs (like the deleteAccount
// one found 2026-07-03) are invisible here even though they bite in prod.
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password_hash TEXT,
    display_name TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    totp_secret TEXT,
    totp_backup_codes TEXT,
    no_group_add INTEGER NOT NULL DEFAULT 0,
    hide_avatar INTEGER NOT NULL DEFAULT 0,
    avatar_exceptions TEXT NOT NULL DEFAULT '[]',
    is_banned INTEGER NOT NULL DEFAULT 0,
    ban_reason TEXT,
    banned_at INTEGER,
    terms_accepted_at INTEGER
  );
  CREATE TABLE otps (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    meta TEXT,
    attempts INTEGER NOT NULL DEFAULT 0
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
  CREATE TABLE refresh_tokens (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
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
  CREATE TABLE chat_collections (
    id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, name TEXT NOT NULL, cover_url TEXT,
    created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE collection_items (
    id TEXT PRIMARY KEY, collection_id TEXT NOT NULL, chat_id TEXT NOT NULL,
    attachment_url TEXT NOT NULL, attachment_type TEXT, attachment_name TEXT,
    attachment_size INTEGER, attachment_meta TEXT, source_message_id TEXT,
    added_by TEXT NOT NULL, added_at INTEGER NOT NULL
  );
  CREATE TABLE message_search_tokens (
    message_id TEXT NOT NULL, chat_id TEXT NOT NULL, token TEXT NOT NULL
  );
  CREATE INDEX idx_mst_token ON message_search_tokens(token, chat_id, message_id);
  CREATE INDEX idx_mst_msg   ON message_search_tokens(message_id);
  -- FK to users(id) WITHOUT cascade, matching 001_initial.js exactly — this is
  -- what makes deleteAccount's FOREIGN KEY bug (found 2026-07-03) reproducible.
  CREATE TABLE calls (
    id TEXT PRIMARY KEY, chat_id TEXT NOT NULL,
    caller_id TEXT NOT NULL REFERENCES users(id),
    callee_id TEXT NOT NULL REFERENCES users(id),
    call_type TEXT NOT NULL DEFAULT 'audio', status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE chat_notes (
    id TEXT PRIMARY KEY, chat_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Заметка', content TEXT NOT NULL DEFAULT '',
    last_edited_by TEXT REFERENCES users(id), last_edited_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL, created_by TEXT REFERENCES users(id)
  );
  -- Matches the post-018 schema (content_type CHECK widened to include
  -- 'message'/'user' for UGC reporting, store-launch audit 2026-07-03).
  CREATE TABLE content_reports (
    id TEXT PRIMARY KEY,
    reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    content_type TEXT NOT NULL CHECK (content_type IN ('sticker_pack','user_gif','message','user')),
    content_id TEXT NOT NULL,
    reason TEXT,
    resolved INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_content_reports_unresolved ON content_reports(resolved, created_at);
  -- Matches 019_moderation_actions.js
  CREATE TABLE user_warnings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    admin_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    message TEXT NOT NULL,
    report_id TEXT REFERENCES content_reports(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    acknowledged_at INTEGER
  );
  CREATE INDEX idx_user_warnings_user ON user_warnings(user_id, acknowledged_at);
`);

// ── Inject mocks into module cache before services are required ───────────────
function mockModule(relPath, exports) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

mockModule('../src/config/database', { getDb: () => db });
// Captures the last OTP "sent" so registration tests can drive the real
// verify step instead of only inspecting the otps table.
let lastSentOtp = null;
mockModule('../src/config/email', {
  sendOtpEmail: async (_to, otp) => { lastSentOtp = otp; },
  sendPasswordResetEmail: async () => {},
});
mockModule('../src/utils/s3Delete', { deleteFromS3: () => {}, deleteManyFromS3: () => {} });

// ── Services (loaded after mocks) ────────────────────────────────────────────
const { validatePassword, loginOrRegister, initiateRegistration, verifyEmailAndCreateAccount } = require('../src/services/authService');
const { deleteMessages, editMessage, getChatMessages, saveMessage, forwardMessages, searchMessages, toggleReaction, toggleEmojiReaction } = require('../src/services/messageService');
const { ALLOWED_TYPES }                     = require('../src/utils/allowedMimeTypes');
const { encrypt, decrypt }                  = require('../src/crypto/aes');
const { setChatBackground, deleteAccount }  = require('../src/services/chatService');

// ── Seed data ────────────────────────────────────────────────────────────────
const NOW = Date.now();
const ALICE_HASH = bcrypt.hashSync('SecurePass1!', 10);

db.prepare('INSERT INTO users (id,username,email,password_hash,display_name,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?)').run(['alice','alice',null,ALICE_HASH,'Alice',NOW,NOW]);
db.prepare('INSERT INTO users (id,username,email,password_hash,display_name,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?)').run(['bob',  'bob',  null,null,      'Bob',  NOW,NOW]);
db.prepare('INSERT INTO users (id,username,email,password_hash,display_name,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?)').run(['carol','carol',null,null,      'Carol',NOW,NOW]);
// Mirrors db/versions/017_deleted_account_ghost.js — the permanent placeholder
// that deleteAccount() reassigns orphaned messages/calls/notes to.
db.prepare('INSERT INTO users (id,username,email,display_name,password_hash,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?)').run(['deleted-account',null,null,'Удалённый аккаунт',null,0,0]);

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

  // ── Store-launch audit (2026-07-04): full report handling — banned accounts ──
  test('banned account with correct credentials is rejected with the reason, not given a session', async () => {
    db.prepare('INSERT INTO users (id,username,email,password_hash,display_name,created_at,last_seen_at,is_banned,ban_reason) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(['banned-login', 'bannedlogin', null, ALICE_HASH, 'Banned', NOW, NOW, 1, 'Спам']);

    await assert.rejects(
      () => loginOrRegister('bannedlogin', 'SecurePass1!'),
      (err) => {
        assert.equal(err.status, 403);
        assert.equal(err.message, 'Аккаунт заблокирован: Спам');
        return true;
      }
    );
  });

  test('correct credentials with no ban proceed normally (sanity check the ban check does not false-positive)', async () => {
    const result = await loginOrRegister('alice', 'SecurePass1!');
    assert.ok(result.accessToken);
    assert.equal(result.user.username, 'alice');
  });
});

// ── Store-launch audit §1 (2026-07-04): consent gate on registration ─────────
describe('initiateRegistration / verifyEmailAndCreateAccount — terms acceptance', () => {
  test('rejects registration when acceptedTerms is not exactly true', async () => {
    await assert.rejects(
      () => initiateRegistration('newperson', 'newperson@example.com', 'SecurePass1!', false),
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /Условия использования/);
        return true;
      }
    );
    await assert.rejects(
      () => initiateRegistration('newperson', 'newperson@example.com', 'SecurePass1!', undefined),
      (err) => { assert.equal(err.status, 400); return true; }
    );
  });

  test('accepted registration carries terms_accepted_at through to the created user', async () => {
    await initiateRegistration('newperson', 'newperson@example.com', 'SecurePass1!', true);
    assert.ok(lastSentOtp, 'OTP should have been "sent"');

    const result = await verifyEmailAndCreateAccount('newperson@example.com', lastSentOtp);
    assert.equal(result.user.username, 'newperson');

    const row = db.prepare('SELECT terms_accepted_at FROM users WHERE username = ?').get('newperson');
    assert.ok(row.terms_accepted_at > 0);
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
    const msg = saveMessage('chat-direct', 'alice', secret);
    // Scan every column of every row — the phrase must appear nowhere as cleartext.
    const rows = db.prepare('SELECT * FROM messages').all();
    const leaked = rows.some(r =>
      Object.values(r).some(v => typeof v === 'string' && v.includes(secret))
    );
    assert.equal(leaked, false, 'plaintext must never be persisted');

    // The blind index must store only opaque HMAC hashes — no readable words.
    const tokens = db.prepare('SELECT token FROM message_search_tokens WHERE message_id = ?').all(msg.id);
    assert.ok(tokens.length > 0, 'message should be indexed');
    assert.ok(tokens.every(t => /^[0-9a-f]{16}$/.test(t.token)),
      'index tokens must be opaque 16-hex HMAC prefixes, never plaintext');
  });

  test('searchMessages finds by PREFIX (search-as-you-type)', () => {
    saveMessage('chat-direct', 'alice', 'летняя конференция была прекрасной');
    const hits = searchMessages('alice', 'конфер'); // префикс слова
    assert.ok(hits.some(h => h.text === 'летняя конференция была прекрасной'),
      'prefix search must locate the message via blind index');
  });

  test('searchMessages re-indexes on edit (old word gone, new word found)', () => {
    const m = saveMessage('chat-direct', 'alice', 'старослово уникум');
    editMessage('chat-direct', m.id, 'alice', 'новослово уникум');
    assert.equal(searchMessages('alice', 'старослово').some(h => h.id === m.id), false);
    assert.equal(searchMessages('alice', 'новослово').some(h => h.id === m.id), true);
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

// ── Store-launch audit (2026-07-03): re-auth gate before account deletion ────
describe('verifyAccountDeletionAuth — reconfirmation before account deletion', () => {
  const { verifyAccountDeletionAuth } = require('../src/services/userService');
  const { encryptSecret, generateSecret, generateBackupCodes, hashBackupCodes } = require('../src/utils/totp');

  test('rejects with 400 when password is missing', async () => {
    await assert.rejects(
      () => verifyAccountDeletionAuth('alice', ''),
      (err) => { assert.equal(err.status, 400); return true; }
    );
  });

  test('rejects with 401 on wrong password', async () => {
    await assert.rejects(
      () => verifyAccountDeletionAuth('alice', 'WrongPassword1!'),
      (err) => { assert.equal(err.status, 401); assert.equal(err.message, 'Неверный пароль'); return true; }
    );
  });

  test('resolves when password is correct and 2FA is not enabled', async () => {
    await assert.doesNotReject(() => verifyAccountDeletionAuth('alice', 'SecurePass1!'));
  });

  test('2FA-enabled user: missing code → 400, wrong code → 401, valid backup code → resolves (and is single-use)', async () => {
    const plainCodes = generateBackupCodes(3);
    const hashed = await hashBackupCodes(plainCodes);
    db.prepare(
      "INSERT INTO users (id,username,email,password_hash,display_name,created_at,last_seen_at,totp_enabled,totp_secret,totp_backup_codes) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).run(['del-2fa','del2fa',null,ALICE_HASH,'Del2fa',NOW,NOW,1,encryptSecret(generateSecret()),JSON.stringify(hashed)]);

    await assert.rejects(
      () => verifyAccountDeletionAuth('del-2fa', 'SecurePass1!'),
      (err) => { assert.equal(err.status, 400); return true; }
    );
    await assert.rejects(
      () => verifyAccountDeletionAuth('del-2fa', 'SecurePass1!', 'NOT-A-REAL-CODE'),
      (err) => { assert.equal(err.status, 401); assert.equal(err.message, 'Неверный код'); return true; }
    );
    await assert.doesNotReject(() => verifyAccountDeletionAuth('del-2fa', 'SecurePass1!', plainCodes[0]));
    // Same backup code can't be reused a second time
    await assert.rejects(
      () => verifyAccountDeletionAuth('del-2fa', 'SecurePass1!', plainCodes[0]),
      (err) => { assert.equal(err.status, 401); return true; }
    );
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

  test('cannot forward a message FROM a chat you are not in (cross-chat IDOR)', () => {
    // carol состоит в chat-group, но НЕ в chat-direct. Она угадывает id секретного
    // сообщения ac-msg-1 (из chat-direct) и пытается переслать его в chat-group,
    // где состоит сама. Источник должен быть молча пропущен → ничего не утекает.
    const res = forwardMessages('chat-group', 'carol', ['ac-msg-1']);
    assert.equal(res.length, 0);
  });
});

// ── S3 safe-serve overrides (stored-content XSS defence) ────────────────────
describe('s3Sign — safe serving metadata', () => {
  const { safeServeOverrides } = require('../src/utils/s3Sign');

  test('non-media key is forced to attachment (cannot render inline)', () => {
    // Even if attacker stored HTML bytes under a .html/.svg/unknown key, GET serves
    // it as a download → no inline execution on the storage origin.
    for (const key of ['x.html', 'x.svg', 'x.bin', 'noext']) {
      const o = safeServeOverrides(key);
      assert.equal(o.ResponseContentDisposition, 'attachment');
      assert.equal(o.ResponseContentType, 'application/octet-stream');
    }
  });

  test('image key serves inline with a safe image content-type', () => {
    const o = safeServeOverrides('abc.webp');
    assert.equal(o.ResponseContentDisposition, 'inline');
    assert.equal(o.ResponseContentType, 'image/webp');
  });

  test('document key (.pdf) is forced to attachment', () => {
    const o = safeServeOverrides('report.pdf');
    assert.equal(o.ResponseContentDisposition, 'attachment');
  });

  test('caller opts override the ext-derived defaults', () => {
    const o = safeServeOverrides('voice.webm', { contentType: 'audio/webm', disposition: 'inline' });
    assert.equal(o.ResponseContentType, 'audio/webm');
    assert.equal(o.ResponseContentDisposition, 'inline');
  });
});

// ── Store-launch audit (2026-07-03): health check reports S3 reachability ───
describe('checkS3Health — health endpoint S3 probe', () => {
  const { checkS3Health } = require('../src/utils/s3Sign');

  test('reports "not_configured" (not a failure) when no S3 env is set — matches this test env', async () => {
    // Test env sets no S3_* vars, so the module's local-disk-mode branch applies.
    assert.equal(await checkS3Health(), 'not_configured');
  });
});

// ── SSRF / DNS-rebinding pin (link preview) ─────────────────────────────────
describe('linkPreview — SSRF guard + DNS pinning', () => {
  const { resolveSafeTarget, isSafeIp } = require('../src/routes/linkPreview');

  test('isSafeIp rejects loopback / private / link-local / mapped', () => {
    assert.equal(isSafeIp('127.0.0.1'), false);
    assert.equal(isSafeIp('10.0.0.5'), false);
    assert.equal(isSafeIp('192.168.1.1'), false);
    assert.equal(isSafeIp('169.254.169.254'), false); // cloud metadata
    assert.equal(isSafeIp('::1'), false);
    assert.equal(isSafeIp('::ffff:127.0.0.1'), false); // IPv4-mapped bypass
    assert.equal(isSafeIp('8.8.8.8'), true);
  });

  test('literal private/metadata IP URLs resolve to null (blocked)', async () => {
    assert.equal(await resolveSafeTarget('http://127.0.0.1/'), null);
    assert.equal(await resolveSafeTarget('http://169.254.169.254/latest/meta-data/'), null);
    assert.equal(await resolveSafeTarget('http://[::1]/'), null);
  });

  test('non-http protocol and non-web ports are blocked', async () => {
    assert.equal(await resolveSafeTarget('file:///etc/passwd'), null);
    assert.equal(await resolveSafeTarget('http://example.com:6379/'), null); // Redis port
  });

  test('public literal IP returns a target pinned to that exact IP', async () => {
    const t = await resolveSafeTarget('https://8.8.8.8/');
    assert.ok(t);
    assert.equal(t.pinIp, '8.8.8.8'); // connection will be pinned here, no re-resolution
    assert.equal(t.pinFamily, 4);
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

  test('seedSavedWelcome вставляет одну карточку welcome_guide (системную, переводится на фронте по attachment_meta)', () => {
    seedSavedWelcome(db, 'chat-saved-seed', 'alice', NOW);
    const rows = db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC').all('chat-saved-seed');
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row.is_system, 1);
    assert.equal(row.sender_id, 'alice');
    assert.equal(row.is_delivered, 1);
    assert.equal(row.attachment_type, 'welcome_guide');
    assert.deepEqual(JSON.parse(row.attachment_meta), { kind: 'welcome_guide' });
  });
});

// ── Ассистент-помощник: LLM-генератор ответа по базе знаний (этап C) ──────────
describe('assistant LLM answer', () => {
  const kb = [
    { id: 'invite', question: 'Как пригласить близких?', answer: 'Личная ссылка и QR.', actions: [{ label: 'Открыть приглашение' }] },
    { id: 'calls', question: 'Как позвонить?', answer: 'Кнопка вызова в шапке чата.', actions: [] },
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

  function mockReply(obj) {
    return async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }) });
  }

  test('isEnabled() = false без env', () => {
    withEnv({ AI_ASSISTANT_ENABLED: '', AI_SUMMARY_ENABLED: '', AI_ASSISTANT_API_KEY: '', AI_SUMMARY_API_KEY: '' }, () => {
      assert.equal(fresh().isEnabled(), false);
    });
  });

  test('answerQuestion бросает 503 когда выключено', async () => {
    await withEnv({ AI_ASSISTANT_ENABLED: '', AI_SUMMARY_ENABLED: '', AI_ASSISTANT_API_KEY: '', AI_SUMMARY_API_KEY: '' }, async () => {
      await assert.rejects(() => fresh().answerQuestion('как позвонить', kb), (e) => e.status === 503);
    });
  });

  test('answerQuestion возвращает ответ + валидные relatedIds', async () => {
    await withEnv({ AI_ASSISTANT_ENABLED: 'true', AI_ASSISTANT_API_KEY: 'k' }, async () => {
      const origFetch = global.fetch;
      global.fetch = mockReply({ reply: 'Создайте ссылку и поделитесь.', covered: true, relatedIds: ['invite'] });
      try {
        const r = await fresh().answerQuestion('как позвать сестру в приложение', kb);
        assert.equal(r.covered, true);
        assert.match(r.reply, /ссылку/);
        assert.deepEqual(r.relatedIds, ['invite']);
      } finally { global.fetch = origFetch; }
    });
  });

  test('answerQuestion отбрасывает relatedIds не из базы', async () => {
    await withEnv({ AI_ASSISTANT_ENABLED: 'true', AI_ASSISTANT_API_KEY: 'k' }, async () => {
      const origFetch = global.fetch;
      global.fetch = mockReply({ reply: 'Ответ.', covered: true, relatedIds: ['invite', 'nonexistent'] });
      try {
        const r = await fresh().answerQuestion('вопрос про приглашение и ещё что-то', kb);
        assert.deepEqual(r.relatedIds, ['invite']);
      } finally { global.fetch = origFetch; }
    });
  });

  test('answerQuestion: covered=false → relatedIds пустой', async () => {
    await withEnv({ AI_ASSISTANT_ENABLED: 'true', AI_ASSISTANT_API_KEY: 'k' }, async () => {
      const origFetch = global.fetch;
      global.fetch = mockReply({ reply: 'В приложении этого нет.', covered: false, relatedIds: ['invite'] });
      try {
        const r = await fresh().answerQuestion('как майнить биткоин', kb);
        assert.equal(r.covered, false);
        assert.deepEqual(r.relatedIds, []);
      } finally { global.fetch = origFetch; }
    });
  });

  test('answerQuestion с пустой базой → covered=false (без вызова LLM)', async () => {
    await withEnv({ AI_ASSISTANT_ENABLED: 'true', AI_ASSISTANT_API_KEY: 'k' }, async () => {
      const r = await fresh().answerQuestion('вопрос', []);
      assert.equal(r.covered, false);
    });
  });
});

// ── Этап D: ассистент по данным чатов ────────────────────────────────────────
describe('Data assistant (Этап D)', () => {
  const da = require('../src/services/dataAssistantService');

  // Дополняем тестовую схему недостающими для фичи столбцами/таблицей.
  try { db.exec("ALTER TABLE users ADD COLUMN birth_date TEXT"); } catch { /* exists */ }
  try { db.exec("ALTER TABLE users ADD COLUMN hide_birth_date INTEGER NOT NULL DEFAULT 0"); } catch { /* exists */ }
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_data_settings (
      user_id TEXT PRIMARY KEY, entitled INTEGER NOT NULL DEFAULT 0,
      optin INTEGER NOT NULL DEFAULT 0, read_messages INTEGER NOT NULL DEFAULT 0,
      scope_all INTEGER NOT NULL DEFAULT 0, allow_chats TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL DEFAULT 0
    )
  `);

  const ME = 'd-me', MOM = 'd-mom', CHAT = 'd-chat', OTHER_CHAT = 'd-chat2';
  const now = Date.now();
  db.prepare('INSERT OR IGNORE INTO users (id, username, email, display_name, created_at, last_seen_at) VALUES (?,?,?,?,?,?)')
    .run([ME, 'dme', 'dme@x.io', 'Я', now, now]);
  db.prepare('INSERT OR IGNORE INTO users (id, username, email, display_name, created_at, last_seen_at, birth_date) VALUES (?,?,?,?,?,?,?)')
    .run([MOM, 'dmom', 'dmom@x.io', 'Мама', now, now, '1970-04-15']);
  db.prepare("INSERT OR IGNORE INTO chats (id, type, created_at) VALUES (?,?,?)").run([CHAT, 'direct', now]);
  db.prepare("INSERT OR IGNORE INTO chats (id, type, created_at) VALUES (?,?,?)").run([OTHER_CHAT, 'direct', now]);
  db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id, joined_at) VALUES (?,?,?)').run([CHAT, ME, now]);
  db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id, joined_at) VALUES (?,?,?)').run([CHAT, MOM, now]);

  function addMsg(id, text) {
    const e = encrypt(text);
    db.prepare(`INSERT OR IGNORE INTO messages (id, chat_id, sender_id, ciphertext, iv, auth_tag, created_at, is_system, is_delivered)
                VALUES (?,?,?,?,?,?,?,0,1)`).run([id, CHAT, MOM, e.ciphertext, e.iv, e.authTag, now]);
  }
  addMsg('d-msg1', 'Встреча с маркетинговым отделом в четверг в 15:00 в офисе');
  addMsg('d-msg2', 'Не забудь купить молоко и хлеб');

  function withEnv(env, fn) {
    const saved = {};
    for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
    try { return fn(); } finally {
      for (const k of Object.keys(env)) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
      }
    }
  }
  function mockFetch(obj) {
    return async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }) });
  }

  test('updateSettings фильтрует allowChats по членству', () => {
    const st = da.updateSettings(ME, { allowChats: [CHAT, OTHER_CHAT, 'foreign-chat'] });
    assert.deepEqual([...st.allowChats].sort(), [CHAT].sort());
  });

  test('answerDataQuestion → 503 когда фича выключена', async () => {
    await withEnv({ AI_DATA_ASSISTANT_ENABLED: '', AI_DATA_API_KEY: '', AI_ASSISTANT_API_KEY: '', AI_SUMMARY_API_KEY: '' }, async () => {
      await assert.rejects(() => da.answerDataQuestion(ME, 'когда встреча'), e => e.status === 503);
    });
  });

  test('answerDataQuestion → 403 без opt-in', async () => {
    da.updateSettings(ME, { optin: false });
    await withEnv({ AI_DATA_ASSISTANT_ENABLED: 'true', AI_DATA_API_KEY: 'k', AI_DATA_ENTITLE_ALL: 'true' }, async () => {
      await assert.rejects(() => da.answerDataQuestion(ME, 'когда встреча'), e => e.status === 403 && e.code === 'not_optin');
    });
  });

  test('структурный ответ про ДР — без вызова LLM', async () => {
    da.updateSettings(ME, { optin: true, readMessages: false });
    await withEnv({ AI_DATA_ASSISTANT_ENABLED: 'true', AI_DATA_API_KEY: 'k', AI_DATA_ENTITLE_ALL: 'true' }, async () => {
      const origFetch = global.fetch;
      global.fetch = async () => { throw new Error('LLM не должен вызываться'); };
      try {
        const r = await da.answerDataQuestion(ME, 'когда день рождения у мамы?');
        assert.equal(r.mode, 'structural');
        assert.equal(r.covered, true);
        assert.equal(r.sources.length, 1);
        assert.equal(r.sources[0].kind, 'profile');
        assert.match(r.reply, /апреля/);
      } finally { global.fetch = origFetch; }
    });
  });

  test('чтение выключено → семантика недоступна (covered=false)', async () => {
    da.updateSettings(ME, { optin: true, readMessages: false });
    await withEnv({ AI_DATA_ASSISTANT_ENABLED: 'true', AI_DATA_API_KEY: 'k', AI_DATA_ENTITLE_ALL: 'true' }, async () => {
      const r = await da.answerDataQuestion(ME, 'когда встреча с маркетингом?');
      assert.equal(r.covered, false);
      assert.equal(r.mode, 'none');
    });
  });

  test('семантика: ответ с валидным источником-сообщением', async () => {
    da.updateSettings(ME, { optin: true, readMessages: true, scopeAll: false, allowChats: [CHAT] });
    await withEnv({ AI_DATA_ASSISTANT_ENABLED: 'true', AI_DATA_API_KEY: 'k', AI_DATA_ENTITLE_ALL: 'true' }, async () => {
      const origFetch = global.fetch;
      global.fetch = mockFetch({ reply: 'В четверг в 15:00.', covered: true, sources: [1] });
      try {
        const r = await da.answerDataQuestion(ME, 'когда встреча с маркетинговым отделом?');
        assert.equal(r.covered, true);
        assert.equal(r.mode, 'semantic');
        assert.equal(r.sources[0].kind, 'message');
        assert.equal(r.sources[0].messageId, 'd-msg1');
        assert.equal(r.sources[0].chatId, CHAT);
      } finally { global.fetch = origFetch; }
    });
  });

  test('covered понижается до false без валидного источника', async () => {
    da.updateSettings(ME, { optin: true, readMessages: true, scopeAll: false, allowChats: [CHAT] });
    await withEnv({ AI_DATA_ASSISTANT_ENABLED: 'true', AI_DATA_API_KEY: 'k', AI_DATA_ENTITLE_ALL: 'true' }, async () => {
      const origFetch = global.fetch;
      global.fetch = mockFetch({ reply: 'Где-то в четверг.', covered: true, sources: [] });
      try {
        const r = await da.answerDataQuestion(ME, 'во сколько была встреча отдела маркетинга?');
        assert.equal(r.covered, false);
        assert.deepEqual(r.sources, []);
      } finally { global.fetch = origFetch; }
    });
  });

  test('нет совпадений-кандидатов → covered=false без вызова LLM', async () => {
    da.updateSettings(ME, { optin: true, readMessages: true, scopeAll: false, allowChats: [CHAT] });
    await withEnv({ AI_DATA_ASSISTANT_ENABLED: 'true', AI_DATA_API_KEY: 'k', AI_DATA_ENTITLE_ALL: 'true' }, async () => {
      const origFetch = global.fetch;
      global.fetch = async () => { throw new Error('LLM не должен вызываться без кандидатов'); };
      try {
        const r = await da.answerDataQuestion(ME, 'квантовая суперпозиция запутанность');
        assert.equal(r.covered, false);
      } finally { global.fetch = origFetch; }
    });
  });
});

// ── Файловые коллекции чата ─────────────────────────────────────────────────
describe('chat collections', () => {
  const col = require('../src/services/collectionService');

  test('ЛС: оба собеседника могут создавать коллекции', () => {
    const a = col.createCollection('chat-direct', 'alice', 'Отпуск');
    assert.equal(a.name, 'Отпуск');
    const b = col.createCollection('chat-direct', 'bob', 'Документы');
    assert.equal(b.name, 'Документы');
  });

  test('группа: участник без edit_info НЕ может создавать (403)', () => {
    // carol — обычный member группы → нет edit_info
    assert.throws(
      () => col.createCollection('chat-group', 'carol', 'Запрещено'),
      (err) => { assert.equal(err.status, 403); return true; },
    );
  });

  test('группа: админ может создавать', () => {
    const c = col.createCollection('chat-group', 'alice', 'Конференция май 2026');
    assert.equal(c.name, 'Конференция май 2026');
  });

  test('не участник чата не видит коллекции (403)', () => {
    // carol не состоит в chat-direct
    assert.throws(
      () => col.listCollections('chat-direct', 'carol'),
      (err) => { assert.equal(err.status, 403); return true; },
    );
  });

  test('загрузка файла в папку + чтение + счётчик', () => {
    const c = col.createCollection('chat-direct', 'alice', 'Фото');
    const item = col.addUploadedItem('chat-direct', c.id, 'alice', {
      attachment_url: 'https://s3/x/photo1.webp', attachment_type: 'image', attachment_name: 'photo1.webp', attachment_size: 1234,
    });
    assert.equal(item.source_message_id, null); // direct upload → коллекция владеет файлом
    const { items } = col.getCollectionItems('chat-direct', c.id, 'bob');
    assert.equal(items.length, 1);
    assert.equal(items[0].attachment_url, 'https://s3/x/photo1.webp');
    const list = col.listCollections('chat-direct', 'alice');
    const found = list.find(x => x.id === c.id);
    assert.equal(found.item_count, 1);
    assert.equal(found.cover_url, 'https://s3/x/photo1.webp'); // обложка-превью из медиа
  });

  test('добавление вложения существующего сообщения (S3 не за коллекцией)', () => {
    db.prepare(
      'INSERT INTO messages (id,chat_id,sender_id,created_at,attachment_url,attachment_type,attachment_name) VALUES (?,?,?,?,?,?,?)'
    ).run(['cm-msg-1', 'chat-direct', 'alice', NOW, 'https://s3/x/doc.pdf', 'file', 'doc.pdf']);
    const c = col.createCollection('chat-direct', 'alice', 'Из чата');
    const item = col.addItemFromMessage('chat-direct', c.id, 'alice', 'cm-msg-1');
    assert.equal(item.source_message_id, 'cm-msg-1'); // ссылка на сообщение → S3 принадлежит сообщению
    assert.equal(item.attachment_url, 'https://s3/x/doc.pdf');
  });

  test('нельзя добавить вложение сообщения из ЧУЖОГО чата', () => {
    // сообщение в chat-group; пытаемся добавить в коллекцию chat-direct
    db.prepare(
      'INSERT INTO messages (id,chat_id,sender_id,created_at,attachment_url,attachment_type) VALUES (?,?,?,?,?,?)'
    ).run(['cm-msg-2', 'chat-group', 'alice', NOW, 'https://s3/x/secret.pdf', 'file']);
    const c = col.createCollection('chat-direct', 'alice', 'Попытка');
    assert.throws(
      () => col.addItemFromMessage('chat-direct', c.id, 'alice', 'cm-msg-2'),
      (err) => { assert.equal(err.status, 404); return true; },
    );
  });

  test('удаление файла и папки', () => {
    const c = col.createCollection('chat-direct', 'alice', 'Удаляемая');
    const item = col.addUploadedItem('chat-direct', c.id, 'alice', { attachment_url: 'https://s3/x/y.webp', attachment_type: 'image' });
    assert.deepEqual(col.removeItem('chat-direct', c.id, 'alice', item.id), { ok: true, id: item.id });
    assert.equal(col.getCollectionItems('chat-direct', c.id, 'alice').items.length, 0);
    col.deleteCollection('chat-direct', c.id, 'alice');
    assert.ok(!col.listCollections('chat-direct', 'alice').some(x => x.id === c.id));
  });
});

// ── Store-launch testing (2026-07-03): deleteAccount FK bug found on a real
// production account — `calls` and `chat_notes` reference users(id) WITHOUT a
// cascade/set-null action (001_initial.js), so a call-history row or an
// authored note blocks `DELETE FROM users` with "FOREIGN KEY constraint
// failed" once foreign_keys=ON (which config/database.js always sets — this
// was invisible in this test file only because it never turned the pragma on
// before now). Confirmed live: an account that had made a WebRTC test call
// got a 500 on deletion; fixed in services/chat/teardown.js.
describe('deleteAccount — orphaned references reassigned to "Удалённый аккаунт" ghost', () => {
  const { searchUsers } = require('../src/services/userService');
  const GHOST = 'deleted-account';

  test('call history and an authored note are reassigned to the ghost, not deleted', () => {
    const NOW2 = Date.now();
    db.prepare('INSERT INTO users (id,username,email,password_hash,display_name,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?)')
      .run(['dave-del', 'davedel', null, ALICE_HASH, 'Dave', NOW2, NOW2]);

    db.prepare('INSERT INTO calls (id,chat_id,caller_id,callee_id,created_at) VALUES (?,?,?,?,?)')
      .run(['call-1', 'chat-direct', 'dave-del', 'alice', NOW2]);
    db.prepare('INSERT INTO chat_notes (id,chat_id,last_edited_by,last_edited_at,created_at,created_by) VALUES (?,?,?,?,?,?)')
      .run(['note-1', 'chat-direct', 'dave-del', NOW2, NOW2, 'dave-del']);

    assert.doesNotThrow(() => deleteAccount('dave-del'));

    assert.equal(db.prepare('SELECT * FROM users WHERE id = ?').get('dave-del'), undefined);
    const call = db.prepare('SELECT * FROM calls WHERE id = ?').get('call-1');
    assert.equal(call.caller_id, GHOST, 'call row survives, reassigned to the ghost — not deleted');
    assert.equal(call.callee_id, 'alice');
    const note = db.prepare('SELECT * FROM chat_notes WHERE id = ?').get('note-1');
    assert.equal(note.last_edited_by, GHOST);
    assert.equal(note.created_by, GHOST);
  });

  test('a message sent in a GROUP chat the user has left is reassigned to the ghost, chat and content survive', () => {
    const NOW3 = Date.now();
    db.prepare('INSERT INTO users (id,username,email,password_hash,display_name,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?)')
      .run(['erin-del', 'erindel', null, ALICE_HASH, 'Erin', NOW3, NOW3]);
    db.prepare('INSERT INTO chats (id,type,name,created_at) VALUES (?,?,?,?)').run(['chat-erin-group', 'group', 'Erin group', NOW3]);
    db.prepare('INSERT INTO chat_members (chat_id,user_id,role,joined_at,unread_count) VALUES (?,?,?,?,?)').run(['chat-erin-group', 'alice',    'admin',  NOW3, 0]);
    db.prepare('INSERT INTO chat_members (chat_id,user_id,role,joined_at,unread_count) VALUES (?,?,?,?,?)').run(['chat-erin-group', 'erin-del', 'member', NOW3, 0]);
    insertMsg('erin-msg-1', 'chat-erin-group', 'erin-del', 'сообщение перед уходом из группы');

    assert.doesNotThrow(() => deleteAccount('erin-del'));

    // Group survives (alice is still a member) — deleting an account must not
    // wipe out a chat other people are still in.
    assert.ok(db.prepare('SELECT id FROM chats WHERE id = ?').get('chat-erin-group'));
    assert.equal(
      db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get('chat-erin-group', 'erin-del'),
      undefined,
      'departed user is removed from chat_members'
    );
    const msg = db.prepare('SELECT sender_id, ciphertext FROM messages WHERE id = ?').get('erin-msg-1');
    assert.equal(msg.sender_id, GHOST, 'message survives, reassigned to the ghost — content not deleted');
    assert.ok(msg.ciphertext, 'message content is untouched (still encrypted, not blanked)');
  });

  test('the ghost account never appears in user search results', () => {
    const results = searchUsers('удал', 'alice');
    assert.ok(!results.some(u => u.id === GHOST));
    const byDisplayName = searchUsers('Удалённый', 'alice');
    assert.ok(!byDisplayName.some(u => u.id === GHOST));
  });
});

describe('deletedAccountCleanup — retention worker prunes old ghost-attributed content', () => {
  const { runCleanup } = require('../src/workers/deletedAccountCleanup');
  const GHOST = 'deleted-account';
  const DAY = 24 * 60 * 60 * 1000;

  test('deletes ghost messages/calls past retention, keeps recent ones and other users\' content', () => {
    const old  = Date.now() - 200 * DAY; // past the 180-day default
    const recent = Date.now() - 5 * DAY;

    insertMsg('ghost-old-msg', 'chat-group', GHOST, 'старое сообщение удалённого аккаунта');
    db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(old, 'ghost-old-msg');

    insertMsg('ghost-recent-msg', 'chat-group', GHOST, 'недавнее сообщение удалённого аккаунта');
    db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(recent, 'ghost-recent-msg');

    db.prepare('INSERT INTO calls (id,chat_id,caller_id,callee_id,created_at) VALUES (?,?,?,?,?)')
      .run(['ghost-old-call', 'chat-group', GHOST, 'alice', old]);

    const result = runCleanup();
    assert.ok(result.messagesDeleted >= 1);
    assert.ok(result.callsDeleted >= 1);

    assert.equal(db.prepare('SELECT id FROM messages WHERE id = ?').get('ghost-old-msg'), undefined);
    assert.equal(db.prepare('SELECT id FROM calls WHERE id = ?').get('ghost-old-call'), undefined);
    // Recent ghost content and any non-ghost content are untouched.
    assert.ok(db.prepare('SELECT id FROM messages WHERE id = ?').get('ghost-recent-msg'));
    assert.ok(db.prepare('SELECT id FROM chats WHERE id = ?').get('chat-group'));
  });
});

// ── Store-launch audit (2026-07-03): UGC reporting on messages/users ────────
describe('contentReportService — report dedup, and content_reports accepts message/user', () => {
  const { createReport } = require('../src/services/contentReportService');

  test('creates a report row with the given content_type', () => {
    createReport('alice', 'message', 'some-msg-id', 'спам');
    const row = db.prepare(
      'SELECT * FROM content_reports WHERE reporter_id = ? AND content_id = ? AND content_type = ?'
    ).get('alice', 'some-msg-id', 'message');
    assert.ok(row);
    assert.equal(row.reason, 'спам');
    assert.equal(row.resolved, 0);
  });

  test('content_type accepts "user" too (CHECK constraint widened by migration 018)', () => {
    createReport('alice', 'user', 'bob', null);
    const row = db.prepare(
      'SELECT * FROM content_reports WHERE reporter_id = ? AND content_id = ? AND content_type = ?'
    ).get('alice', 'bob', 'user');
    assert.ok(row);
  });

  test('the same reporter cannot report the same content twice (409)', () => {
    assert.throws(
      () => createReport('alice', 'message', 'some-msg-id', 'ещё раз'),
      (err) => { assert.equal(err.status, 409); return true; }
    );
  });

  test('a different reporter CAN report the same content', () => {
    assert.doesNotThrow(() => createReport('bob', 'message', 'some-msg-id', 'тоже спам'));
  });
});

// ── Store-launch audit (2026-07-04): full report handling — moderationService ──
describe('moderationService — ban/unban/warn/acknowledge', () => {
  const {
    banUser, unbanUser, warnUser, getModerationInfo,
    getUnacknowledgedWarnings, acknowledgeWarning,
  } = require('../src/services/moderationService');

  function makeUser(id, username) {
    db.prepare('INSERT INTO users (id,username,email,password_hash,display_name,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?)')
      .run([id, username, null, ALICE_HASH, username, NOW, NOW]);
  }

  // admin_id/user_id in user_warnings/sessions are real FKs to users(id) — every
  // "acting admin" id used below must be a real row, this is the shared one.
  makeUser('mod-admin-1', 'modadmin1');

  test('banUser sets flags and revokes all active sessions/refresh tokens', () => {
    makeUser('mod-target-1', 'modtarget1');
    db.prepare('INSERT INTO sessions (id,user_id,created_at,revoked) VALUES (?,?,?,0)').run(['sess-1', 'mod-target-1', NOW]);
    db.prepare('INSERT INTO sessions (id,user_id,created_at,revoked) VALUES (?,?,?,0)').run(['sess-2', 'mod-target-1', NOW]);
    db.prepare('INSERT INTO refresh_tokens (id,session_id,user_id,expires_at,revoked,created_at) VALUES (?,?,?,?,0,?)').run(['rt-1', 'sess-1', 'mod-target-1', NOW + 1000, NOW]);

    const result = banUser('mod-target-1', 'Нарушение правил', 'mod-admin-1');
    assert.equal(result.ok, true);
    assert.deepEqual(result.sessionIds.sort(), ['sess-1', 'sess-2']);

    const user = db.prepare('SELECT is_banned, ban_reason FROM users WHERE id = ?').get('mod-target-1');
    assert.equal(user.is_banned, 1);
    assert.equal(user.ban_reason, 'Нарушение правил');
    assert.equal(db.prepare('SELECT revoked FROM sessions WHERE id = ?').get('sess-1').revoked, 1);
    assert.equal(db.prepare('SELECT revoked FROM sessions WHERE id = ?').get('sess-2').revoked, 1);
    assert.equal(db.prepare('SELECT revoked FROM refresh_tokens WHERE id = ?').get('rt-1').revoked, 1);
  });

  test('banUser refuses to let an admin ban themselves', () => {
    makeUser('mod-self', 'modself');
    assert.throws(
      () => banUser('mod-self', 'test', 'mod-self'),
      (err) => { assert.equal(err.status, 400); return true; }
    );
  });

  test('unbanUser clears the ban flags', () => {
    makeUser('mod-target-2', 'modtarget2');
    banUser('mod-target-2', 'reason', 'mod-admin-1');
    unbanUser('mod-target-2');
    const user = db.prepare('SELECT is_banned, ban_reason, banned_at FROM users WHERE id = ?').get('mod-target-2');
    assert.equal(user.is_banned, 0);
    assert.equal(user.ban_reason, null);
    assert.equal(user.banned_at, null);
  });

  test('warnUser records a warning and resolves the linked report; getModerationInfo returns it with the admin username', () => {
    makeUser('mod-target-3', 'modtarget3');
    makeUser('mod-admin', 'modadmin');
    db.prepare("INSERT INTO content_reports (id,reporter_id,content_type,content_id,reason,resolved,created_at) VALUES (?,?,?,?,?,0,?)")
      .run(['report-for-warn', 'bob', 'user', 'mod-target-3', 'test', NOW]);

    const warning = warnUser('mod-target-3', 'Пожалуйста, соблюдайте правила', 'mod-admin', 'report-for-warn');
    assert.ok(warning.id);

    const report = db.prepare('SELECT resolved FROM content_reports WHERE id = ?').get('report-for-warn');
    assert.equal(report.resolved, 1, 'warning with a reportId marks that report resolved');

    const info = getModerationInfo('mod-target-3');
    assert.equal(info.warnings.length, 1);
    assert.equal(info.warnings[0].admin_username, 'modadmin');
    assert.equal(info.warnings[0].message, 'Пожалуйста, соблюдайте правила');
  });

  test('warnUser rejects an empty message', () => {
    makeUser('mod-target-4', 'modtarget4');
    assert.throws(
      () => warnUser('mod-target-4', '   ', 'mod-admin-1', null),
      (err) => { assert.equal(err.status, 400); return true; }
    );
  });

  test('unacknowledged warnings show up for the user and disappear once acknowledged', () => {
    makeUser('mod-target-5', 'modtarget5');
    const w = warnUser('mod-target-5', 'Первое предупреждение', 'mod-admin-1', null);

    const before = getUnacknowledgedWarnings('mod-target-5');
    assert.equal(before.length, 1);
    assert.equal(before[0].id, w.id);

    acknowledgeWarning('mod-target-5', w.id);
    const after = getUnacknowledgedWarnings('mod-target-5');
    assert.equal(after.length, 0);
  });

  test('acknowledging someone else\'s warning (or an already-acknowledged one) fails', () => {
    makeUser('mod-target-6', 'modtarget6');
    const w = warnUser('mod-target-6', 'test', 'mod-admin-1', null);
    assert.throws(
      () => acknowledgeWarning('someone-else', w.id),
      (err) => { assert.equal(err.status, 404); return true; }
    );
    acknowledgeWarning('mod-target-6', w.id);
    assert.throws(
      () => acknowledgeWarning('mod-target-6', w.id),
      (err) => { assert.equal(err.status, 404); return true; }
    );
  });
});
