/**
 * 010_drop_plaintext_search.js — устранение открытого текста сообщений at-rest.
 *
 * До этой миграции рядом с зашифрованным телом сообщения (ciphertext/iv/auth_tag)
 * хранилась колонка messages.search_text — ПОЛНЫЙ открытый текст, плюс его копия
 * в FTS5-таблице messages_fts. Это сводило на нет шифрование: любой доступ к .db
 * (том /data, бэкап в S3) давал всю переписку в открытом виде.
 *
 * Теперь:
 *   • поиск работает дешифровкой кандидатов в памяти (messageService.searchMessages);
 *   • вкладка «ссылки» опирается на 1-битный флаг messages.has_link (есть ли URL),
 *     а не на текст;
 *   • колонка search_text и таблица messages_fts (обе хранят cleartext) удаляются.
 *
 * Миграция идемпотентна и безопасна для повторного применения.
 */
const { decrypt } = require('../../crypto/aes');

function up(db) {
  // 1. Новый флаг has_link (есть ли в тексте сообщения URL) — для вкладки «ссылки».
  try {
    db.exec('ALTER TABLE messages ADD COLUMN has_link INTEGER NOT NULL DEFAULT 0');
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) throw e;
  }

  // 2. Бэкфилл has_link по существующим сообщениям (дешифровка в транзакции).
  //    MESSAGE_ENCRYPTION_KEY к этому моменту уже провалидирован на старте.
  const URL_RE = /https?:\/\//i;
  const setLink = db.prepare('UPDATE messages SET has_link = 1 WHERE id = ?');
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT id, ciphertext, iv, auth_tag FROM messages
       WHERE ciphertext IS NOT NULL AND is_system = 0 AND deleted_at IS NULL`
    ).all();
  } catch { rows = []; }

  const backfill = db.transaction(() => {
    for (const r of rows) {
      try {
        const text = decrypt({ ciphertext: r.ciphertext, iv: r.iv, authTag: r.auth_tag });
        if (URL_RE.test(text)) setLink.run(r.id);
      } catch { /* битая/недешифруемая строка — пропускаем */ }
    }
  });
  backfill();

  // 3. Сносим FTS5-таблицу и её триггеры (они хранят копию открытого текста).
  db.exec(`
    DROP TRIGGER IF EXISTS messages_fts_insert;
    DROP TRIGGER IF EXISTS messages_fts_update;
    DROP TRIGGER IF EXISTS messages_fts_delete;
    DROP TABLE   IF EXISTS messages_fts;
  `);

  // 4. Затираем и удаляем колонку search_text (исторический открытый текст).
  //    Сначала обнуляем (на случай старого SQLite без DROP COLUMN), затем дропаем.
  try { db.exec('UPDATE messages SET search_text = NULL'); } catch { /* колонки нет */ }
  try {
    db.exec('ALTER TABLE messages DROP COLUMN search_text');
  } catch (e) {
    // SQLite < 3.35 не умеет DROP COLUMN — содержимое уже затёрто шагом выше.
    if (!/no such column|near "DROP"|DROP COLUMN/i.test(e.message)) throw e;
  }
}

module.exports = { up };
