/**
 * routes/collections.js — файловые коллекции чата («папки файлов»).
 * Монтируется под /chats (как notes/dailyPrompts): /chats/:chatId/collections...
 *
 *   GET    /:chatId/collections                              — список папок (+обложки)
 *   POST   /:chatId/collections                              — создать {name}
 *   PATCH  /:chatId/collections/:collectionId                — переименовать {name}
 *   DELETE /:chatId/collections/:collectionId                — удалить папку
 *   GET    /:chatId/collections/:collectionId/items          — файлы папки
 *   POST   /:chatId/collections/:collectionId/items          — добавить загруженный файл
 *   POST   /:chatId/collections/:collectionId/items/from-message — добавить вложение сообщения
 *   DELETE /:chatId/collections/:collectionId/items/:itemId  — убрать файл
 *
 * Бизнес-логика и права — в collectionService. Здесь только HTTP + подпись S3-ссылок.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../middleware/auth');
const {
  listCollections, createCollection, renameCollection, deleteCollection,
  getCollectionItems, addUploadedItem, addItemFromMessage, removeItem,
} = require('../services/collectionService');
const { signUrl, signMessageUrls } = require('../utils/s3Sign');

const router = express.Router();
router.use(authMiddleware);

// Broadcast a collection change to all members of the chat (room chat:<id>,
// joined by every member's sockets on connect). Payload always carries chatId.
function emitCol(req, event, payload) {
  req.app.get('io')?.to(`chat:${req.params.chatId}`).emit(event, { chatId: req.params.chatId, ...payload });
}

const collectionsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Слишком много запросов. Подождите немного.' },
  standardHeaders: true,
  legacyHeaders: false,
});
router.use('/:chatId/collections', collectionsLimiter);

// GET /:chatId/collections — список папок с обложками
router.get('/:chatId/collections', async (req, res, next) => {
  try {
    const cols = listCollections(req.params.chatId, req.userId);
    await Promise.all(cols.map(async (c) => {
      if (c.cover_url) c.cover_url = await signUrl(c.cover_url);
    }));
    res.json(cols);
  } catch (err) { next(err); }
});

// POST /:chatId/collections — создать
router.post('/:chatId/collections', (req, res, next) => {
  try {
    const col = createCollection(req.params.chatId, req.userId, req.body?.name);
    emitCol(req, 'collection:created', { collection: col });
    res.status(201).json(col);
  } catch (err) { next(err); }
});

// PATCH /:chatId/collections/:collectionId — переименовать
router.patch('/:chatId/collections/:collectionId', (req, res, next) => {
  try {
    const out = renameCollection(req.params.chatId, req.params.collectionId, req.userId, req.body?.name);
    emitCol(req, 'collection:updated', { collectionId: out.id, name: out.name });
    res.json(out);
  } catch (err) { next(err); }
});

// DELETE /:chatId/collections/:collectionId — удалить папку
router.delete('/:chatId/collections/:collectionId', (req, res, next) => {
  try {
    const out = deleteCollection(req.params.chatId, req.params.collectionId, req.userId);
    emitCol(req, 'collection:deleted', { collectionId: req.params.collectionId });
    res.json(out);
  } catch (err) { next(err); }
});

// GET /:chatId/collections/:collectionId/items — файлы папки
router.get('/:chatId/collections/:collectionId/items', async (req, res, next) => {
  try {
    const { collection, items } = getCollectionItems(req.params.chatId, req.params.collectionId, req.userId);
    await signMessageUrls(items); // подписывает attachment_url по тем же правилам, что у сообщений
    res.json({ collection: { id: collection.id, name: collection.name, created_by: collection.created_by }, items });
  } catch (err) { next(err); }
});

// POST /:chatId/collections/:collectionId/items — добавить загруженный напрямую файл
router.post('/:chatId/collections/:collectionId/items', async (req, res, next) => {
  try {
    const { attachment_url, attachment_type, attachment_name, attachment_size, attachment_meta } = req.body || {};
    const item = addUploadedItem(req.params.chatId, req.params.collectionId, req.userId, {
      attachment_url, attachment_type, attachment_name, attachment_size, attachment_meta,
    });
    await signMessageUrls([item]);
    emitCol(req, 'collection:item-added', { collectionId: req.params.collectionId, item });
    res.status(201).json(item);
  } catch (err) { next(err); }
});

// POST /:chatId/collections/:collectionId/items/from-message — добавить вложение сообщения
router.post('/:chatId/collections/:collectionId/items/from-message', async (req, res, next) => {
  try {
    const item = addItemFromMessage(req.params.chatId, req.params.collectionId, req.userId, req.body?.messageId);
    await signMessageUrls([item]);
    emitCol(req, 'collection:item-added', { collectionId: req.params.collectionId, item });
    res.status(201).json(item);
  } catch (err) { next(err); }
});

// DELETE /:chatId/collections/:collectionId/items/:itemId — убрать файл
router.delete('/:chatId/collections/:collectionId/items/:itemId', (req, res, next) => {
  try {
    const out = removeItem(req.params.chatId, req.params.collectionId, req.userId, req.params.itemId);
    emitCol(req, 'collection:item-removed', { collectionId: req.params.collectionId, itemId: req.params.itemId });
    res.json(out);
  } catch (err) { next(err); }
});

module.exports = router;
