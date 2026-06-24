'use strict';

/**
 * 013_invite_tokens.js — постоянные личные пригласительные ссылки (Этап B).
 *
 * Одна активная (revoked=0) ссылка на пользователя; «обновить» = отозвать старую
 * и создать новую. Переход по ссылке (после входа/регистрации) делает обоих
 * друзьями и открывает ЛС. Токен — случайный, не перечислимый.
 */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invite_tokens (
      token        TEXT PRIMARY KEY,
      inviter_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      revoked      INTEGER NOT NULL DEFAULT 0,
      used_count   INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL,
      last_used_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_invite_tokens_inviter ON invite_tokens(inviter_id, revoked);
  `);
}

module.exports = { up };
