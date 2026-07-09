'use strict';

/**
 * docs/STORE_LAUNCH_TZ.md §10 — backend push delivery coverage.
 *
 * services/pushService.js's buildBody() is already covered (per-language
 * strings) by tests/i18n.test.js. This file covers the surrounding delivery
 * logic that buildBody sits inside: fireAndForgetPush (offline/muted
 * filtering, per-recipient-language dispatch, expired-subscription cleanup)
 * and sendCallPush (fan-out to all of a callee's subscriptions).
 * utils/webPush is mocked — no real network calls are made.
 */

process.env.MESSAGE_ENCRYPTION_KEY = '0'.repeat(64);
process.env.JWT_SECRET = 'push-test-jwt-secret';
process.env.NODE_ENV = 'test';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY, username TEXT, display_name TEXT NOT NULL DEFAULT '', language TEXT
  );
  CREATE TABLE chat_members (
    chat_id TEXT NOT NULL, user_id TEXT NOT NULL, is_muted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, user_id)
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
mockModule('../src/utils/logger', { info: () => {}, warn: () => {}, error: () => {} });

// sentCalls records every mocked send; failEndpoints makes sendPush resolve
// false (simulating an expired/410 subscription) for specific endpoints.
const sentCalls = [];
const failEndpoints = new Set();
mockModule('../src/utils/webPush', {
  sendPush: async (subscription, payload) => {
    sentCalls.push({ subscription, payload });
    return !failEndpoints.has(subscription.endpoint);
  },
});

const { fireAndForgetPush, sendCallPush } = require('../src/services/pushService');

async function waitUntil(predicate, timeout = 1000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('waitUntil: timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

let seq = 0;
function seedUser(id, { language = null } = {}) {
  db.prepare('INSERT INTO users (id, display_name, language) VALUES (?,?,?)').run(id, id, language);
}
function seedSub(userId) {
  const endpoint = `https://push.example/${userId}-${seq++}`;
  db.prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth_key) VALUES (?,?,?,?,?)')
    .run(`sub-${endpoint}`, userId, endpoint, 'p256dh-key', 'auth-key');
  return endpoint;
}

describe('pushService.fireAndForgetPush', () => {
  test('delivers only to offline, non-muted members; skips online and muted ones', async () => {
    const chatId = 'chat-a';
    seedUser('sam', { language: 'ru' });
    seedUser('olga', { language: 'ru' });
    seedUser('ivy', { language: 'ru' });
    seedUser('oscar', { language: 'ru' });
    for (const [u, muted] of [['sam', 0], ['olga', 0], ['ivy', 1], ['oscar', 0]]) {
      db.prepare('INSERT INTO chat_members (chat_id, user_id, is_muted) VALUES (?,?,?)').run(chatId, u, muted);
    }
    seedSub('olga');
    seedSub('ivy');   // muted — must be skipped despite having a subscription
    seedSub('oscar'); // online — must be skipped

    const before = sentCalls.length;
    const fakeIo = { onlineUsers: new Map([['oscar', 1]]) };
    fireAndForgetPush(chatId, 'sam', { text: 'Hello there', attachment_type: null, attachment_meta: null }, fakeIo);

    await waitUntil(() => sentCalls.length > before);
    await new Promise((r) => setTimeout(r, 30)); // ensure no extra (unwanted) sends trickle in

    const newCalls = sentCalls.slice(before);
    assert.equal(newCalls.length, 1);
    assert.equal(newCalls[0].payload.chatId, chatId);
    assert.equal(newCalls[0].payload.title, 'sam');
    assert.equal(newCalls[0].payload.body, 'Hello there');
  });

  test('builds a separate body per distinct recipient language', async () => {
    const chatId = 'chat-b';
    seedUser('mira', { language: 'ru' });
    seedUser('ru-guy', { language: 'ru' });
    seedUser('en-guy', { language: 'en' });
    for (const u of ['mira', 'ru-guy', 'en-guy']) {
      db.prepare('INSERT INTO chat_members (chat_id, user_id, is_muted) VALUES (?,?,0)').run(chatId, u);
    }
    seedSub('ru-guy');
    seedSub('en-guy');

    const before = sentCalls.length;
    const fakeIo = { onlineUsers: new Map() };
    fireAndForgetPush(chatId, 'mira', { text: '', attachment_type: 'image', attachment_meta: null }, fakeIo);

    await waitUntil(() => sentCalls.length >= before + 2);
    const newCalls = sentCalls.slice(before);
    const bodies = newCalls.map((c) => c.payload.body).sort();
    assert.deepEqual(bodies, ['📷 Photo', '📷 Фото']);
  });

  test('deletes the subscription when sendPush reports it expired (410)', async () => {
    const chatId = 'chat-c';
    seedUser('tom', { language: 'ru' });
    seedUser('nina', { language: 'ru' });
    db.prepare('INSERT INTO chat_members (chat_id, user_id, is_muted) VALUES (?,?,0)').run(chatId, 'tom');
    db.prepare('INSERT INTO chat_members (chat_id, user_id, is_muted) VALUES (?,?,0)').run(chatId, 'nina');
    const endpoint = seedSub('nina');
    failEndpoints.add(endpoint);

    const before = sentCalls.length;
    fireAndForgetPush(chatId, 'tom', { text: 'gone soon', attachment_type: null, attachment_meta: null }, { onlineUsers: new Map() });
    await waitUntil(() => sentCalls.length > before);
    await waitUntil(() => !db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').get(endpoint));

    assert.equal(db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').get(endpoint), undefined);
  });
});

describe('pushService.sendCallPush', () => {
  test('fans out to every subscription of the callee, localized by callee language', async () => {
    seedUser('callee-en', { language: 'en' });
    seedSub('callee-en');
    seedSub('callee-en');

    const before = sentCalls.length;
    sendCallPush('callee-en', { callId: 'c-1', callType: 'video', callerName: 'Alex', chatId: 'chat-x' });
    await waitUntil(() => sentCalls.length >= before + 2);

    const newCalls = sentCalls.slice(before);
    assert.equal(newCalls.length, 2);
    for (const c of newCalls) {
      assert.equal(c.payload.type, 'call');
      assert.equal(c.payload.title, 'Incoming video call');
      assert.equal(c.payload.body, 'Alex is calling…');
      assert.equal(c.payload.callId, 'c-1');
      assert.equal(c.payload.chatId, 'chat-x');
      assert.equal(c.payload.callType, 'video');
    }
  });

  test('audio call uses the audio title, in the callee\'s language', async () => {
    seedUser('callee-ru', { language: 'ru' });
    seedSub('callee-ru');

    const before = sentCalls.length;
    sendCallPush('callee-ru', { callId: 'c-2', callType: 'audio', callerName: 'Женя', chatId: 'chat-y' });
    await waitUntil(() => sentCalls.length > before);

    assert.equal(sentCalls[before].payload.title, 'Входящий звонок');
    assert.equal(sentCalls[before].payload.body, 'Женя звонит…');
  });

  test('no-op when the callee has no subscriptions (no throw)', async () => {
    seedUser('lonely', { language: 'ru' });
    const before = sentCalls.length;
    sendCallPush('lonely', { callId: 'c-3', callType: 'audio', callerName: 'X', chatId: 'chat-z' });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(sentCalls.length, before);
  });
});
