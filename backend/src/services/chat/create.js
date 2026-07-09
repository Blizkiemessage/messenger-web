/**
 * services/chat/create.js — chat creation.
 *   createGroupChat, getOrCreateDirectChat, getOrCreateSavedChat
 */
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../../config/database');
const { encrypt } = require('../../crypto/aes');
const { getChatById } = require('./queries');

// Фолбэк-текст приветственной карточки «Избранного» — виден только там, где
// attachment_type не распознан (админ-панель/очень старый кэш фронта); сама
// карточка (см. WelcomeGuideCard.tsx) полностью переведена через i18n и не
// зависит от этой строки.
const WELCOME_GUIDE_FALLBACK_TEXT = '👋 Добро пожаловать в «Избранное»';

/**
 * Засеять приветственную карточку в только что созданный saved-чат.
 * Карточка — системное сообщение (is_system=1) с attachment_type='welcome_guide':
 * контент рендерится компонентом WelcomeGuideCard целиком через i18n (переводится
 * на язык UI), а не хранится литеральным текстом в ciphertext (как раньше).
 * Вызывается один раз — из ветки создания getOrCreateSavedChat (идемпотентно).
 * Экспортируется отдельно для тестируемости.
 */
function seedSavedWelcome(db, chatId, userId, baseTime = Date.now()) {
  const { ciphertext, iv, authTag } = encrypt(WELCOME_GUIDE_FALLBACK_TEXT);
  db.prepare(
    `INSERT INTO messages (id, chat_id, sender_id, ciphertext, iv, auth_tag, created_at, is_system, is_delivered, attachment_type, attachment_meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 'welcome_guide', ?)`
  ).run([uuidv4(), chatId, userId, ciphertext, iv, authTag, baseTime, JSON.stringify({ kind: 'welcome_guide' })]);
}

function createGroupChat(name, creatorId, memberIds, description) {
  const db = getDb();

  const validMemberIds = memberIds.filter(id => {
    const u = db.prepare('SELECT no_group_add FROM users WHERE id = ?').get(id);
    return !u?.no_group_add;
  });

  const allMembers = [...new Set([creatorId, ...validMemberIds])];
  if (allMembers.length < 2) {
    throw Object.assign(new Error('Добавьте хотя бы одного участника'), { status: 400 });
  }

  const chatId = uuidv4();
  const now = Date.now();
  const desc = description ? description.trim() : null;

  db.exec('BEGIN');
  try {
    db.prepare(
      'INSERT INTO chats (id, type, name, description, creator_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run([chatId, 'group', name.trim(), desc, creatorId, now]);

    for (const memberId of allMembers) {
      db.prepare(
        'INSERT INTO chat_members (chat_id, user_id, joined_at, role) VALUES (?, ?, ?, ?)'
      ).run([chatId, memberId, now, memberId === creatorId ? 'admin' : 'member']);
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return getChatById(chatId, creatorId);
}

function getOrCreateDirectChat(userAId, userBId) {
  const db = getDb();

  const existing = db
    .prepare(
      `SELECT c.id FROM chats c
       JOIN chat_members cm1 ON cm1.chat_id = c.id AND cm1.user_id = ?
       JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id = ?
       WHERE c.type = 'direct' LIMIT 1`
    )
    .get([userAId, userBId]);

  if (existing) return getChatById(existing.id, userAId);

  const chatId = uuidv4();
  const now = Date.now();

  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO chats (id, type, created_at) VALUES (?, ?, ?)').run([chatId, 'direct', now]);
    db.prepare('INSERT INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)').run([chatId, userAId, now]);
    db.prepare('INSERT INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)').run([chatId, userBId, now]);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return getChatById(chatId, userAId);
}

function getOrCreateSavedChat(userId) {
  const db = getDb();

  const existing = db
    .prepare(
      `SELECT c.id FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = ?
       WHERE c.type = 'saved' LIMIT 1`
    )
    .get([userId]);

  if (existing) return getChatById(existing.id, userId);

  const chatId = uuidv4();
  const now = Date.now();

  db.exec('BEGIN');
  try {
    db.prepare(
      'INSERT INTO chats (id, type, name, creator_id, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run([chatId, 'saved', 'Сохранённые сообщения', userId, now]);
    db.prepare(
      'INSERT INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)'
    ).run([chatId, userId, now]);
    seedSavedWelcome(db, chatId, userId, now);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return getChatById(chatId, userId);
}

module.exports = { createGroupChat, getOrCreateDirectChat, getOrCreateSavedChat, seedSavedWelcome };
