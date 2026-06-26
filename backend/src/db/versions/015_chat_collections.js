/**
 * 015_chat_collections.js — Файловые коллекции чата («папки файлов»).
 *
 * Общие на чат именованные папки для медиа/документов («Конференция май 2026»):
 * фото/видео/файлы складываются в коллекцию и НЕ попадают в ленту чата
 * (collection-only «файловый диск»). Видны всем участникам; управление —
 * как у фона чата (ЛС: оба; группа: право edit_info).
 *
 *   chat_collections   — сами папки (имя, обложка, автор).
 *   collection_items   — файлы внутри. attachment_* — как у messages.
 *     source_message_id:
 *       NULL      — файл загружен НАПРЯМУЮ в коллекцию → коллекция владеет S3-объектом
 *                   (удаляем из S3 при удалении элемента/папки).
 *       не NULL   — элемент ссылается на вложение существующего сообщения
 *                   (S3-объект принадлежит сообщению → из S3 НЕ удаляем).
 *
 * FK ON DELETE CASCADE: удаление чата уносит коллекции, удаление коллекции —
 * её элементы (PRAGMA foreign_keys = ON выставлен в config/database). S3-объекты
 * direct-upload элементов чистятся явно в сервисе ДО удаления строк.
 */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_collections (
      id          TEXT PRIMARY KEY,
      chat_id     TEXT NOT NULL,
      name        TEXT NOT NULL,
      cover_url   TEXT,
      created_by  TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chat_collections_chat ON chat_collections(chat_id);

    CREATE TABLE IF NOT EXISTS collection_items (
      id                TEXT PRIMARY KEY,
      collection_id     TEXT NOT NULL,
      chat_id           TEXT NOT NULL,
      attachment_url    TEXT NOT NULL,
      attachment_type   TEXT,
      attachment_name   TEXT,
      attachment_size   INTEGER,
      attachment_meta   TEXT,
      source_message_id TEXT,
      added_by          TEXT NOT NULL,
      added_at          INTEGER NOT NULL,
      FOREIGN KEY (collection_id) REFERENCES chat_collections(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_collection_items_collection ON collection_items(collection_id);
  `);
}

module.exports = { up };
