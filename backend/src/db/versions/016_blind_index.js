/**
 * 016_blind_index.js — «слепой индекс» для поиска по зашифрованным сообщениям.
 *
 * Раньше поиск дешифровал последние 5000 сообщений в памяти и искал подстроку —
 * O(n), с обрезкой по 5000 (старое не находилось). Теперь по каждому сообщению
 * храним необратимые отпечатки префиксов слов (keyed-HMAC, ключ HKDF-производный
 * от MESSAGE_ENCRYPTION_KEY) в message_search_tokens — открытого текста по-прежнему
 * НЕТ, но поиск идёт по индексу: хешируем слово запроса → находим кандидатов →
 * дешифруем только их и сверяем подстроку. См. utils/searchIndex.js.
 *
 * token — hex первых 8 байт HMAC (16 симв.); коллизии ничтожны и добиваются
 * финальной сверкой по подстроке. Индекс по (token, chat_id, message_id) —
 * покрывающий для поискового запроса; по (message_id) — для ре-индексации/чистки.
 *
 * Бэкфилл: одноразово дешифровать существующие сообщения и проиндексировать.
 */
const { decrypt } = require('../../crypto/aes');
const { indexTokens } = require('../../utils/searchIndex');

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_search_tokens (
      message_id TEXT NOT NULL,
      chat_id    TEXT NOT NULL,
      token      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mst_token ON message_search_tokens(token, chat_id, message_id);
    CREATE INDEX IF NOT EXISTS idx_mst_msg   ON message_search_tokens(message_id);
  `);

  // ── One-time backfill ──────────────────────────────────────────────────────
  // Index every existing non-system message. Idempotent at the migration level
  // (this version runs once); decrypt failures are skipped, not fatal.
  const rows = db.prepare(
    'SELECT id, chat_id, ciphertext, iv, auth_tag FROM messages WHERE is_system = 0'
  ).all();
  if (rows.length === 0) return;

  const ins = db.prepare('INSERT INTO message_search_tokens (message_id, chat_id, token) VALUES (?, ?, ?)');
  const run = db.transaction(() => {
    for (const m of rows) {
      let text;
      try { text = decrypt({ ciphertext: m.ciphertext, iv: m.iv, authTag: m.auth_tag }); }
      catch { continue; }
      for (const t of indexTokens(text)) ins.run(m.id, m.chat_id, t);
    }
  });
  run();
}

module.exports = { up };
