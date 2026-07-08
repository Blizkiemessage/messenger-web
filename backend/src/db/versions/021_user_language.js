'use strict';

/**
 * 021_user_language.js — предпочитаемый язык интерфейса пользователя.
 *
 * users.language — 'ru' | 'en', синкается между устройствами так же, как
 * theme/accent_color (PATCH /users/me). NOT NULL DEFAULT 'ru' — аудитория
 * приложения русскоязычная (см. CLAUDE.md), автоопределение по языку
 * браузера сознательно не делаем (общий компьютер в русскоязычной семье с
 * английской локалью ОС не должен переключать язык сам по себе).
 */
function up(db) {
  try {
    db.exec("ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'ru'");
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) throw e;
  }
}

module.exports = { up };
