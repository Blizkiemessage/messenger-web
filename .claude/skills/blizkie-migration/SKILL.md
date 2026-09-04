---
name: blizkie-migration
description: Миграции схемы БД в Blizkie (backend/src/db/versions/). Use when adding
  or altering a table or column, adding a column that REFERENCES users(id), changing
  a CHECK or DEFAULT constraint, backfilling existing rows, or when account deletion
  breaks with a FOREIGN KEY constraint error. Covers the numbering and file contract,
  why an applied migration must never be edited, the table-rebuild SQLite needs for
  CHECK/DEFAULT, the ON DELETE decision that broke account deletion in production,
  and the manual test schema that silently hides such bugs.
---

# Миграции схемы БД в Blizkie

Движок — `backend/src/db/migrate.js`. Его шапка описывает контракт подробно;
здесь — то, чего в ней нет: проектные правила и грабли, стоившие продовых багов.

## 1. Контракт файла

- Имя: `backend/src/db/versions/NNN_краткое_имя.js`, `NNN` — следующий свободный
  номер с ведущими нулями. Порядок применения — лексикографическая сортировка
  имён файлов, поэтому нули обязательны.
- Экспорт: `module.exports = { up }`, где `up(db)` получает инстанс
  better-sqlite3. **Синхронный код** — `db.exec()` / `db.prepare()`, без `async`.
- Каждая миграция выполняется в одной транзакции и после успеха записывается в
  `schema_migrations`. Упала — откат и сервер НЕ стартует.
- Пишите `up()` идемпотентно: `CREATE TABLE IF NOT EXISTS`, а для `ALTER TABLE
  ADD COLUMN` — try/catch с проверкой `duplicate column` (образец —
  `021_user_language.js`).

## 2. Никогда не редактировать применённую миграцию

На проде она уже отработала и повторно не запустится — правка задним числом
разведёт схему прода и схему свежего клона. Нужно изменить сделанное раньше —
только НОВОЙ миграцией.

Тот же запрет действует на смену `DEFAULT` у существующей колонки. Живой пример:
`001_initial.js` до сих пор объявляет `accent_color ... DEFAULT '#2f81f7'` (синий,
отменённый редизайном «Аврора»). Чинили это не правкой миграции, а тем, что
`authService.js` передаёт `DEFAULT_ACCENT_COLOR` явно при вставке пользователя.

## 3. SQLite не умеет ALTER COLUMN

Смена `CHECK`, `DEFAULT` или типа колонки делается только пересборкой таблицы:
создать новую с нужной схемой → перелить данные → удалить старую → переименовать.
Образец — `018_content_reports_message_user.js` (расширение `CHECK` на
`content_type`). Для большой центральной таблицы (`users`, `messages`) сначала
подумайте, нельзя ли решить задачу на уровне приложения — как в примере с
`accent_color` выше.

## 4. Главная ловушка: ссылки на users(id)

`PRAGMA foreign_keys = ON` включён всегда (`config/database.js`). Новая колонка с
`REFERENCES users(id)` **без явной стратегии удаления** ломает `deleteAccount()` —
у первого же пользователя, у которого появится такая строка.

Так и случилось 2026-07-03: `calls.caller_id`, `chat_notes.created_by` и
`messages.sender_id` ссылались на `users(id)` без `ON DELETE`, и реальное удаление
аккаунта падало с `Internal server error` у любого, кто хоть раз звонил. Тесты
этого не видели.

Развилка, которую нужно пройти ДО написания схемы:

**Сущность видят другие участники** (сообщение, звонок, заметка чата, реакция,
закреплённое) — её нельзя удалять вместе с автором, иначе вы стираете контент из
чужих чатов. Ссылку при удалении аккаунта переносить на постоянную заглушку
`userService.DELETED_ACCOUNT_USER_ID` (`id='deleted-account'`, заведена
`017_deleted_account_ghost.js`) — в `services/chat/teardown.js::deleteAccount`.
Контент, унаследованный заглушкой, стареет и чистится
`workers/deletedAccountCleanup.js` (`DELETED_ACCOUNT_RETENTION_DAYS`).

**Сущность приватная** и не видна никому, кроме владельца (сессия, подписка на
push, черновик, избранное) — обычный `ON DELETE CASCADE` / `SET NULL` прямо в
схеме, как у `sessions` и `friends`. Ничего дописывать в `teardown.js` не нужно.

## 5. Шифрование: не заводить колонок для открытого текста

Тексты сообщений лежат зашифрованными (AES-GCM: `ciphertext`/`iv`/`auth_tag`),
открытого текста at-rest в базе нет — колонку `search_text` и FTS5 специально
удалила `010_drop_plaintext_search.js`. Не создавайте колонок, куда попадёт
plaintext пользовательского текста (в том числе «временно, для отладки»). Для
поиска есть слепой индекс `message_search_tokens` (`utils/searchIndex.js`), для
признака ссылки — однобитный флаг `messages.has_link`.

Если новая миграция должна проиндексировать существующие сообщения — расшифровка
допустима только В ПАМЯТИ на время бэкфилла, результат в базу пишется хешами
(образец — `016_blind_index.js`).

## 6. Тестовая схема — отдельная и ручная

`backend/tests/smoke.test.js` собирает свою in-memory схему вручную (`db.exec`
в начале файла), она НЕ строится из `db/versions/`. Значит новую таблицу или
колонку нужно добавить и туда, иначе тест просто не увидит проблему.

Там же включён `db.pragma('foreign_keys = ON')` — специально, чтобы FK-баги
вроде описанного в §4 ловились тестами, а не на проде.

Юнит-тестов на отдельные миграции в проекте нет. Если миграция делает
нетривиальный бэкфилл, проверьте её одноразовым скриптом на копии БД (применить
все версии → посеять данные → применить новую → прогнать `up()` второй раз и
убедиться, что она идемпотентна), скрипт после проверки удалить.

## 7. Чек-лист перед сдачей

1. Новый файл `NNN_*.js`, старые не тронуты.
2. Развилка §4 пройдена осознанно; если выбран перенос на заглушку — правка в
   `services/chat/teardown.js::deleteAccount` внесена.
3. Колонка/таблица добавлена в ручную схему `smoke.test.js`.
4. `cd backend && npm test` — зелёное.
5. Схема изменилась структурно (новая таблица/сущность) — обновить раздел
   структуры в `CLAUDE.md`, не только журнал.
