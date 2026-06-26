/**
 * collectionService.js — файловые коллекции чата («папки файлов»).
 *
 * Общие на чат папки для медиа/документов; файлы живут в коллекции и НЕ
 * попадают в ленту (collection-only). Чтение — любой участник; запись
 * (создать/переименовать/удалить папку, добавить/убрать файл) — как фон чата:
 * ЛС — оба собеседника, группа — право edit_info (admin всегда; модератор/
 * участник — если выдано). Структура — миграция 015.
 *
 * Только бизнес-логика + проверки; подпись S3-ссылок делает роут (s3Sign),
 * чтобы сервис оставался тестируемым без S3.
 */
'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { getMemberPermissions } = require('./chatPermissions');
const { deleteFromS3 } = require('../utils/s3Delete');

const MAX_NAME_LEN = 80;
const MAX_COLLECTIONS_PER_CHAT = 200;
const MAX_ITEMS_PER_COLLECTION = 2000;

const forbidden = () => Object.assign(new Error('Forbidden'), { status: 403 });
const notFound = (m = 'Not found') => Object.assign(new Error(m), { status: 404 });
const badReq = (m) => Object.assign(new Error(m), { status: 400 });

/** Требует членство в чате; возвращает строку chats. */
function assertMember(db, chatId, userId) {
  const chat = db.prepare('SELECT id, type FROM chats WHERE id = ?').get(chatId);
  if (!chat) throw notFound('Chat not found');
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, userId]);
  if (!member) throw forbidden();
  return chat;
}

/**
 * Требует право УПРАВЛЕНИЯ коллекциями: ЛС — любой участник; группа — edit_info
 * (admin всегда; модератор/участник — если выдано или включено «всем»).
 * Зеркалит правило setChatBackground.
 */
function assertCanManage(db, chatId, userId) {
  const chat = assertMember(db, chatId, userId);
  if (chat.type === 'group') {
    const perms = getMemberPermissions(db, chatId, userId);
    if (!perms || !perms.edit_info) {
      throw Object.assign(new Error('Недостаточно прав для управления коллекциями'), { status: 403 });
    }
  }
  return chat;
}

function cleanName(name) {
  if (!name || typeof name !== 'string' || !name.trim()) throw badReq('Введите название');
  return name.trim().slice(0, MAX_NAME_LEN);
}

/** Список коллекций чата + кол-во элементов и обложка-превью (последний медиа-элемент). */
function listCollections(chatId, userId) {
  const db = getDb();
  assertMember(db, chatId, userId);
  const rows = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM collection_items i WHERE i.collection_id = c.id) AS item_count,
      (SELECT i.attachment_url FROM collection_items i
        WHERE i.collection_id = c.id
          AND i.attachment_type IN ('image','video','video_note','gif_custom','gif_tenor')
        ORDER BY i.added_at DESC LIMIT 1) AS preview_url
    FROM chat_collections c
    WHERE c.chat_id = ?
    ORDER BY c.updated_at DESC
  `).all(chatId);
  return rows.map(r => ({
    id: r.id,
    chat_id: r.chat_id,
    name: r.name,
    cover_url: r.cover_url || r.preview_url || null,
    item_count: r.item_count,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

function createCollection(chatId, userId, name) {
  const db = getDb();
  assertCanManage(db, chatId, userId);
  const clean = cleanName(name);
  const count = db.prepare('SELECT COUNT(*) AS n FROM chat_collections WHERE chat_id = ?').get(chatId).n;
  if (count >= MAX_COLLECTIONS_PER_CHAT) throw badReq('Достигнут лимит коллекций в чате');

  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    'INSERT INTO chat_collections (id, chat_id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run([id, chatId, clean, userId, now, now]);
  return { id, chat_id: chatId, name: clean, cover_url: null, item_count: 0, created_by: userId, created_at: now, updated_at: now };
}

function renameCollection(chatId, collectionId, userId, name) {
  const db = getDb();
  assertCanManage(db, chatId, userId);
  const col = db.prepare('SELECT id FROM chat_collections WHERE id = ? AND chat_id = ?').get([collectionId, chatId]);
  if (!col) throw notFound('Коллекция не найдена');
  const clean = cleanName(name);
  db.prepare('UPDATE chat_collections SET name = ?, updated_at = ? WHERE id = ?').run([clean, Date.now(), collectionId]);
  return { id: collectionId, name: clean };
}

/** Удалить коллекцию: сначала чистим S3 у direct-upload элементов, затем строки (CASCADE). */
function deleteCollection(chatId, collectionId, userId) {
  const db = getDb();
  assertCanManage(db, chatId, userId);
  const col = db.prepare('SELECT id FROM chat_collections WHERE id = ? AND chat_id = ?').get([collectionId, chatId]);
  if (!col) throw notFound('Коллекция не найдена');

  const owned = db.prepare(
    'SELECT attachment_url FROM collection_items WHERE collection_id = ? AND source_message_id IS NULL'
  ).all(collectionId);
  for (const it of owned) if (it.attachment_url) deleteFromS3(it.attachment_url); // fire-and-forget

  db.prepare('DELETE FROM chat_collections WHERE id = ?').run(collectionId); // CASCADE → items
  return { ok: true, id: collectionId };
}

/** Элементы коллекции (новые сверху). Подпись S3-ссылок — на роуте. */
function getCollectionItems(chatId, collectionId, userId) {
  const db = getDb();
  assertMember(db, chatId, userId);
  const col = db.prepare('SELECT * FROM chat_collections WHERE id = ? AND chat_id = ?').get([collectionId, chatId]);
  if (!col) throw notFound('Коллекция не найдена');
  const items = db.prepare(
    'SELECT * FROM collection_items WHERE collection_id = ? ORDER BY added_at DESC'
  ).all(collectionId);
  return { collection: col, items };
}

function _touch(db, collectionId) {
  db.prepare('UPDATE chat_collections SET updated_at = ? WHERE id = ?').run([Date.now(), collectionId]);
}

function _assertCollection(db, chatId, collectionId) {
  const col = db.prepare('SELECT id FROM chat_collections WHERE id = ? AND chat_id = ?').get([collectionId, chatId]);
  if (!col) throw notFound('Коллекция не найдена');
  const count = db.prepare('SELECT COUNT(*) AS n FROM collection_items WHERE collection_id = ?').get(collectionId).n;
  if (count >= MAX_ITEMS_PER_COLLECTION) throw badReq('Достигнут лимит файлов в коллекции');
}

/** Добавить файл, загруженный НАПРЯМУЮ в коллекцию (коллекция владеет S3-объектом). */
function addUploadedItem(chatId, collectionId, userId, attachment) {
  const db = getDb();
  assertCanManage(db, chatId, userId);
  _assertCollection(db, chatId, collectionId);

  const url = attachment?.attachment_url;
  if (!url || typeof url !== 'string') throw badReq('attachment_url обязателен');

  const id = uuidv4();
  const now = Date.now();
  db.prepare(`
    INSERT INTO collection_items
      (id, collection_id, chat_id, attachment_url, attachment_type, attachment_name,
       attachment_size, attachment_meta, source_message_id, added_by, added_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).run([
    id, collectionId, chatId, url,
    attachment.attachment_type || null,
    attachment.attachment_name || null,
    typeof attachment.attachment_size === 'number' ? attachment.attachment_size : null,
    typeof attachment.attachment_meta === 'string' ? attachment.attachment_meta : null,
    userId, now,
  ]);
  _touch(db, collectionId);
  return db.prepare('SELECT * FROM collection_items WHERE id = ?').get(id);
}

/** Добавить в коллекцию вложение существующего сообщения (S3-объект остаётся за сообщением). */
function addItemFromMessage(chatId, collectionId, userId, messageId) {
  const db = getDb();
  assertCanManage(db, chatId, userId);
  _assertCollection(db, chatId, collectionId);

  // Сообщение должно быть в ЭТОМ чате и иметь вложение (членство уже проверено).
  const msg = db.prepare(
    'SELECT id, attachment_url, attachment_type, attachment_name, attachment_size, attachment_meta FROM messages WHERE id = ? AND chat_id = ? AND deleted_at IS NULL'
  ).get([messageId, chatId]);
  if (!msg) throw notFound('Сообщение не найдено');
  if (!msg.attachment_url) throw badReq('У сообщения нет вложения');

  const id = uuidv4();
  const now = Date.now();
  db.prepare(`
    INSERT INTO collection_items
      (id, collection_id, chat_id, attachment_url, attachment_type, attachment_name,
       attachment_size, attachment_meta, source_message_id, added_by, added_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run([
    id, collectionId, chatId, msg.attachment_url,
    msg.attachment_type || null, msg.attachment_name || null,
    msg.attachment_size != null ? msg.attachment_size : null,
    msg.attachment_meta || null, messageId, userId, now,
  ]);
  _touch(db, collectionId);
  return db.prepare('SELECT * FROM collection_items WHERE id = ?').get(id);
}

/** Убрать элемент: удаляем S3-объект только если он принадлежит коллекции (direct upload). */
function removeItem(chatId, collectionId, userId, itemId) {
  const db = getDb();
  assertCanManage(db, chatId, userId);
  const item = db.prepare(
    'SELECT id, attachment_url, source_message_id FROM collection_items WHERE id = ? AND collection_id = ? AND chat_id = ?'
  ).get([itemId, collectionId, chatId]);
  if (!item) throw notFound('Файл не найден');

  db.prepare('DELETE FROM collection_items WHERE id = ?').run(itemId);
  if (!item.source_message_id && item.attachment_url) deleteFromS3(item.attachment_url); // owned → cleanup
  _touch(db, collectionId);
  return { ok: true, id: itemId };
}

module.exports = {
  listCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  getCollectionItems,
  addUploadedItem,
  addItemFromMessage,
  removeItem,
  // exported for tests
  assertCanManage,
  MAX_NAME_LEN,
};
