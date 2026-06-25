/**
 * 014_data_assistant.js — Этап D: ассистент по данным чатов («второй мозг»).
 *
 * Настройки приватности/доступа ассистента живут в ОТДЕЛЬНОЙ таблице (а не
 * колонками users), чтобы не раздувать общий updateUser и держать чувствительную
 * фичу изолированно. Строка появляется лениво при первом изменении настроек;
 * отсутствие строки = всё выключено (максимально приватный дефолт).
 *
 *   user_id        — владелец настроек
 *   entitled       — выдан ли доступ к платной фиче (управляется админом/энтайтлментом)
 *   optin          — пользователь ЯВНО включил ассистента по данным (строгий opt-in)
 *   read_messages  — разрешено читать ТЕКСТ сообщений (иначе — только структурные
 *                    данные: ДР/события). По умолчанию 0.
 *   scope_all      — 1 = доступны ВСЕ чаты пользователя (кнопка «выбрать все»)
 *   allow_chats    — JSON-массив id чатов из allowlist (когда scope_all=0)
 *   updated_at     — время последнего изменения
 *
 * Кэш ответов/расшифрованный текст В БД НЕ ХРАНИМ (ROADMAP: «никогда не хранить
 * расшифрованный текст/ответы дольше необходимого») — кэш только in-memory в сервисе.
 */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_data_settings (
      user_id       TEXT PRIMARY KEY,
      entitled      INTEGER NOT NULL DEFAULT 0,
      optin         INTEGER NOT NULL DEFAULT 0,
      read_messages INTEGER NOT NULL DEFAULT 0,
      scope_all     INTEGER NOT NULL DEFAULT 0,
      allow_chats   TEXT    NOT NULL DEFAULT '[]',
      updated_at    INTEGER NOT NULL DEFAULT 0
    )
  `);
}
module.exports = { up };
