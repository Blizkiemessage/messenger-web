'use strict';

/**
 * 012_daily_prompts.js — фича «Вопрос дня» (флагман «общая память»).
 *
 * Создаёт 4 таблицы:
 *   chat_daily_prompts          — конфиг фичи на чат (вкл/выкл, время, расписание,
 *                                 источник вопросов, состояние «мешка» без повторов).
 *   chat_daily_prompt_questions — собственные вопросы чата (пользовательский контент).
 *   daily_prompt_instances      — каждый заданный вопрос (текст в шифре). Это и есть
 *                                 «архив»: список инстансов = лента воспоминаний.
 *   daily_prompt_answers        — ответы участников (текст в шифре + любое вложение:
 *                                 голос/кружок/медиа — те же attachment-колонки, что
 *                                 в messages). Ответы НЕ попадают в общую ленту чата,
 *                                 живут в отдельном треде вопроса.
 *
 * Текст вопросов и ответов хранится ТОЛЬКО как AES-256-GCM шифр (ciphertext/iv/
 * auth_tag) — никакого плейнтекста at-rest, как и у обычных сообщений.
 *
 * Все DDL идемпотентны (IF NOT EXISTS) — миграция безопасна на существующей БД.
 */

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_daily_prompts (
      chat_id          TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
      enabled          INTEGER NOT NULL DEFAULT 0,
      send_time        INTEGER NOT NULL DEFAULT 1260,         -- минут от полуночи (1260 = 21:00)
      timezone         TEXT    NOT NULL DEFAULT 'Europe/Moscow',
      schedule         TEXT    NOT NULL DEFAULT '{"type":"daily"}',
      source           TEXT    NOT NULL DEFAULT '{"banks":["family"],"use_builtin":1,"use_custom":1}',
      order_mode       TEXT    NOT NULL DEFAULT 'shuffle',    -- 'shuffle' | 'sequential'
      bag_state        TEXT    NOT NULL DEFAULT '{}',         -- {used:[keys], seq:n}
      push_enabled     INTEGER NOT NULL DEFAULT 1,
      push_text        TEXT,
      last_sent_date   TEXT,                                  -- 'YYYY-MM-DD' в timezone чата
      updated_by       TEXT REFERENCES users(id),
      updated_at       INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS chat_daily_prompt_questions (
      id         TEXT PRIMARY KEY,
      chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      text       TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by TEXT REFERENCES users(id),
      created_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_dp_questions_chat
      ON chat_daily_prompt_questions(chat_id, sort_order);

    CREATE TABLE IF NOT EXISTS daily_prompt_instances (
      id           TEXT PRIMARY KEY,
      chat_id      TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      ciphertext   TEXT NOT NULL,
      iv           TEXT NOT NULL,
      auth_tag     TEXT NOT NULL,
      category     TEXT,                                      -- id банка или 'custom'
      question_key TEXT,                                      -- 'b:family:0' | 'c:<id>' (для статистики)
      date_key     TEXT NOT NULL,                             -- 'YYYY-MM-DD' в timezone чата
      message_id   TEXT,                                      -- карточка-вопрос в ленте (messages.id)
      answer_count INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dp_instances_chat
      ON daily_prompt_instances(chat_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_dp_instances_date
      ON daily_prompt_instances(chat_id, date_key);

    CREATE TABLE IF NOT EXISTS daily_prompt_answers (
      id                  TEXT PRIMARY KEY,
      instance_id         TEXT NOT NULL REFERENCES daily_prompt_instances(id) ON DELETE CASCADE,
      chat_id             TEXT NOT NULL,
      user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ciphertext          TEXT NOT NULL DEFAULT '',
      iv                  TEXT NOT NULL DEFAULT '',
      auth_tag            TEXT NOT NULL DEFAULT '',
      attachment_url      TEXT,
      attachment_type     TEXT,
      attachment_name     TEXT,
      attachment_meta     TEXT,
      attachment_size     INTEGER,
      attachment_duration REAL,
      voice_waveform      TEXT,
      created_at          INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dp_answers_instance
      ON daily_prompt_answers(instance_id, created_at);
  `);
}

module.exports = { up };
