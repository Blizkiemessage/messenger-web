# Blizkie Messenger («мои близкие») — карта проекта для ИИ-агентов

Этот файл — главный ориентир по проекту. Прочитав его, агент должен понимать структуру
без дополнительного исследования. **Правила работы с файлом — в конце.**

## Что это

Веб-мессенджер для семьи/друзей: личные и групповые чаты, медиа, стикеры/GIF, опросы,
голосовые/видеозвонки (WebRTC), заметки чата, папки, PWA с push-уведомлениями.
Язык интерфейса — русский.

- **Backend:** Node.js + Express + Socket.io + better-sqlite3 (синхронный SQLite). Папка `backend/`.
- **Frontend:** React 19 + TypeScript + Vite + Zustand. Папка `web/`.
- **Деплой:** backend — Amvera (Docker, том `/data` для SQLite; `amvera.yaml`); frontend — Vercel (сборка из исходников, `web/vercel.json`). `DEPLOY.md` местами устарел (упоминает Railway).
- **Рабочая ветка:** `devDK`. Основная: `main`.

## Структура

```
backend/src/
  index.js          # точка входа: регистрация всех роутов, intervals (доставка отложенных сообщений и т.п.)
  config/           # env, БД, почта
  crypto/aes.js     # AES-256-GCM шифрование текста сообщений (ключ MESSAGE_ENCRYPTION_KEY)
  db/versions/      # миграции 001–005 (вся схема БД здесь; новая таблица = новый файл миграции)
  middleware/       # auth.js (JWT), errorHandler.js, rateLimits.js, csrfOrigin.js (Origin-проверка мутаций)
  routes/           # 22 файла — REST API, имя файла = префикс (auth, users, chats, messages, upload,
                    #   admin, friends, support, polls, push, search, sessions, linkPreview,
                    #   sticker-packs, gif, totp, calls, notes, folders, health, export, webauthn).
                    #   admin.js — оркестратор: login + auth+isAdmin + монтирует под-роутеры
                    #     admin/* (stats, users, chats, moderation, stickerRepair, diagnostics);
                    #     публичные URL не менялись.
  services/         # бизнес-логика, вызывается из routes
                    #   chatService.js — barrel; реализация в services/chat/*.js
                    #   (queries — getChatById/getUserChats; create; prefs — pin/mute;
                    #    members — участники/роли/группа; teardown — удаление; backgrounds)
  socket/socketServer.js  # весь realtime: new-message, typing, presence, call:* (сигналинг WebRTC)
  utils/            # jwt, s3 (подпись ссылок), otp, logger
  workers/          # dbBackup.js (бэкап БД в S3), s3Cleanup.js
backend/tests/smoke.test.js   # node --test; запуск: cd backend && npm test

web/src/
  app.css           # barrel: только @import шрифта и 18 модулей styles/*.css В ПОРЯДКЕ каскада
  styles/           # реальные стили, разбиты по областям (01-tokens-auth-layout … 18-aurora-overrides).
                    #   Порядок @import в app.css = старый порядок строк, менять нельзя. Токены/переменные
                    #   :root — в 01-tokens-auth-layout.css; слой переопределений «Аврора» —
                    #   18-aurora-overrides.css, ДОЛЖЕН оставаться последним
  config.ts         # VITE_API_BASE_URL / VITE_SOCKET_URL (дефолт http://localhost:3000)
  types.ts          # общие TS-интерфейсы
  api/              # axios-обёртки, 1 файл = 1 группа эндпоинтов (client.ts — базовый инстанс)
  store/            # 9 Zustand-сторов: useSessionStore (auth), useChatsStore (чаты+сообщения),
                    #   useAppStore (UI/тема), useCallStore, useStickerStore, useGifStore,
                    #   useDraftStore, useNotesStore, useFolderStore
  hooks/useSocket.ts    # ВСЕ подписки на socket-события сервера
  socket/socketClient.ts # подключение + все emit'ы на сервер
  components/
    auth/           # экраны входа/регистрации/восстановления
    sidebar/        # Sidebar, ChatList, ChatItem, поиск, папки
    chat/           # ChatArea, MessageList, панель эмодзи/стикеров, опросы.
                    #   ChatArea.tsx — оркестратор чата; самодостаточные слайсы вынесены в
                    #     chat/chatArea/* (helpers + хуки useMessageSearch/useDragDrop/usePinnedMessages)
                    #   MessageBubble.tsx — оркестратор; презентационные части в chat/messageBubble/*
                    #     (helpers, attachments, MediaPlayers, ReactionBar, QuotedText)
                    #   Composer.tsx — крупный (запись голоса/видео-кружков, стейт-машина в нём же);
                    #     чистые куски вынесены в chat/composer/* (helpers, icons, PreviewPlayer)
    modals/         # все модалки (группы, пересылка, медиа, настройки профиля и т.д.).
                    #   StickerStudioModal.tsx — оркестратор; чистые части в modals/stickerStudio/*
                    #     (types — StudioTab/WizardStep/PendingItem; helpers — константы/formatQuota/getVideoDuration/parseGifDuration)
    profile/        # вкладки настроек (профиль, пароль, приватность, сессии, passkeys...)
    call/           # IncomingCallModal, CallOverlay
    notes/          # заметки чата: NotesPanel.tsx — оркестратор (список + переключение);
                    #   types, helpers, MediaBlocks, NoteSettings, NoteEditor — рядом
    ui/             # переиспользуемые: Avatar, ContextMenu, Toggle, Portal, icons/
  services/webrtcManager.ts  # WebRTC peer connection звонков
  utils/            # theme.ts (тема), accent.ts (акцент пользователя), appBackground.ts (фон
                    #   приложения: solid/gradient через --app-bg; модель AppBg переиспользовать
                    #   для будущих per-chat фонов через --chat-bg на .chatArea), format.ts, push.ts
```

## Типовые задачи — куда лезть (для экономии токенов)

| Задача | Файлы |
|---|---|
| Изменить внешний вид / цвета / шрифты | `web/src/styles/*.css` (нужный модуль по области; `app.css` — лишь barrel @import'ов, его не трогать). Токены в `:root` — `styles/01-tokens-auth-layout.css`; точечные правки — в слой «Аврора» `styles/18-aurora-overrides.css` (он последний, перекрывает всё). Не хардкодить цвета — использовать переменные |
| Новая кнопка/поведение в чате | `web/src/components/chat/` + при необходимости стор `useChatsStore` |
| Новый REST-эндпоинт | `backend/src/routes/<область>.js` (+ сервис) → обёртка в `web/src/api/<область>.ts` → вызов из компонента |
| Новое realtime-событие | `backend/src/socket/socketServer.js` → emit в `web/src/socket/socketClient.ts` → подписка в `web/src/hooks/useSocket.ts` |
| Изменение схемы БД | новый файл в `backend/src/db/versions/` (миграции нумерованные, применяются автоматически при старте) |
| Сообщения (отправка, реакции, пины, пересылка) | `backend/src/routes/messages.js`, `web/src/components/chat/MessageBubble.tsx`, `MessageList.tsx` |
| Звонки | `backend/src/routes/calls.js`, `socket/socketServer.js` (call:*), `web/src/services/webrtcManager.ts`, `useCallStore` |
| Загрузка файлов/медиа | `backend/src/routes/upload.js` (S3/Yandex Cloud), `web/src/components/chat/Composer.tsx` |

## Конвенции и грабли

- **Сообщения в БД зашифрованы** (AES-GCM): поля `ciphertext/iv/auth_tag`. **Открытого текста at-rest НЕТ** (миграция 010 удалила колонку `search_text` и FTS5 — они хранили cleartext). Поиск — дешифровкой кандидатов в памяти (`messageService.searchMessages`, поиск по подстроке). Вкладка «ссылки» опирается на 1-битный флаг `messages.has_link` (есть ли URL), который проставляется при записи/редактировании из плейнтекста ДО шифрования (`textHasLink`). Меняя логику сообщений — НЕ хранить текст в открытом виде; обновлять `has_link`, а не несуществующий `search_text`.
- **Дизайн «Аврора»**: фиолетовый акцент `--accent`, градиент `--grad-accent` для главных кнопок, свечение `--glow`. Старый синий `#2f81f7` не возвращать.
- **simplewebauthn v9** — API именно девятой версии (см. коммиты cbb10504 и ранее), не обновлять вслепую.
- `web/dist/` в git частично устарел и игнорируется — **не коммитить**, Vercel собирает сам.
- `backend/data/*.db*` — локальная БД, **никогда не коммитить**.
- Backend не стартует без `JWT_SECRET` и `MESSAGE_ENCRYPTION_KEY`.
- **Бэкапы БД зашифрованы на уровне приложения** (AES-256-GCM, `utils/backupCrypto.js`) ДО загрузки в S3 — ключи S3 не дают доступа к содержимому. Ключ: `DB_BACKUP_ENCRYPTION_KEY` (64 hex), иначе HKDF от `MESSAGE_ENCRYPTION_KEY` (всегда включено). Опц. изоляция: `DB_BACKUP_S3_BUCKET` + `DB_BACKUP_S3_ACCESS_KEY_ID`/`_SECRET_ACCESS_KEY` (отдельный бакет/ключи только-на-запись). Объекты — `*.db.enc`; восстановление: `npm run restore-backup -- <файл|--s3 ключ> [out.db]` (`--list` для списка).
- Проверка фронта: `cd web && npm run build` (tsc + vite) — обязательна перед пушем.
- Тесты бэкенда: `cd backend && npm test`.

## Как работать с этим файлом (инструкция агенту)

1. **Перед задачей** — сориентируйся по таблице «Типовые задачи», не сканируй проект целиком.
2. **После каждой содержательной задачи** — добавь ОДНУ строку в журнал ниже (новые сверху):
   `ДАТА | область | что сделано (+ хеш коммита)`. Кратко, без воды.
3. **Если структура изменилась** (новая папка, новый стор, новый роут) — обнови соответствующий
   раздел выше, а не только журнал.
4. Журнал держать не длиннее ~40 строк: старые записи группировать в одну строку-сводку.

## Журнал изменений

- 2026-06-20 | refactor/web | `StickerStudioModal.tsx` (991 строка) — чистые части вынесены в `components/modals/stickerStudio/`: `types.ts` (StudioTab/WizardStep/PendingItem), `helpers.ts` (MAX_ITEMS/MAX_SECONDS/ACCEPT_TYPES/formatQuota/getVideoDuration/parseGifDuration). Код перенесён дословно, Props/JSX/поведение не менялись. Оркестратор 991→927 строк. Сборка (strict tsc + vite) зелёная.

- 2026-06-18 | refactor/web | `ChatArea.tsx` (990 строк) — самодостаточные слайсы вынесены в `components/chat/chatArea/`: `helpers.ts` (splitMessage/MAX_MSG_CHARS/EMPTY_TYPING), хуки `useMessageSearch` (поиск по сообщениям), `useDragDrop` (перетаскивание файлов), `usePinnedMessages` (закреплённые: загрузка/синк/навигация + pin/unpin одиночный/контекст/массовый). Хуки — behavior-preserving (код перенесён дословно, те же deps), узкие интерфейсы. Связанное ядро (отправка/оптимизм/правка/ответы/опросы/расписание) осознанно оставлено в оркестраторе — оно сильно завязано на общий стейт. ChatArea: 990→853 строк, импорт из App не тронут. Сборка (strict tsc + vite) зелёная, приложение грузится без ошибок консоли.

- 2026-06-18 | refactor/web | `NotesPanel.tsx` (1031 строка) разбит на соседние файлы в `components/notes/`: `types` (модель блоков), `helpers` (uid/parse/serialize/relTime/fmt*/fileColor/canEdit/snippet), `MediaBlocks` (FileIcon/Lightbox/NoteVideoBlock/MediaBlock/UploadBar), `NoteSettings` (права edit/visibility), `NoteEditor` (большой блочный редактор). `NotesPanel.tsx` остаётся оркестратором (список + создание + переключение в редактор) на прежнем пути — импорт из ChatArea не тронут. Код перенесён дословно, Props/поведение не менялись. Сборка (strict tsc + vite) зелёная, приложение грузится без ошибок консоли.

- 2026-06-18 | refactor/backend | `admin.js` (765 строк) разбит на оркестратор + 6 под-роутеров в `routes/admin/`: `_shared` (clientIp), `stats`, `users` (+ /sessions/:id), `chats`, `moderation` (content-reports + sticker-packs), `stickerRepair` (большой self-healing handler), `diagnostics` (errors + audit-log + backup). `admin.js` теперь делает только: login route → `router.use(authMiddleware)` → `router.use(isAdmin)` → монтирует под-роутеры (они наследуют auth-гейт). Внешняя точка `app.use('/admin/api', adminRoutes)` и публичные URL не менялись. Проверено механически: `router.stack` отдаёт **те же 19 маршрутов**, что и до правки (METHOD+path). Все 88 backend-тестов зелёные.

- 2026-06-18 | refactor/web | `Composer.tsx` (1576 строк) — вынесены НЕЗАВИСИМЫЕ части в `components/chat/composer/`: `helpers.ts` (fmt/computeWaveformBars/getFileCategory), `icons.tsx` (FileIconBadge/WaveformIcon/VideoNoteIcon), `PreviewPlayer.tsx` (самодостаточный мини-плеер голосового). Стейт-машина записи голоса/видео-кружков (≈30 useState/ref, общие pointer-хендлеры) ОСТАВЛЕНА в Composer.tsx осознанно — она сильно связана, а проверить её без микрофона/входа нельзя, поэтому дробить её рискованно. Код перенесён дословно, Props/поведение не тронуты. Сборка (strict tsc + vite) зелёная, приложение грузится без ошибок консоли.

- 2026-06-18 | refactor/web | `MessageBubble.tsx` (1149 строк) разбит: презентационные части вынесены в `components/chat/messageBubble/` (`helpers` — размер/категория файла, url-хелперы, кастом-эмодзи; `attachments` — BubbleFileIcon/FileCard/ImageAttachment/VideoAttachment; `MediaPlayers` — AudioPlayer/VideoNotePlayer; `ReactionBar`; `QuotedText`). `MessageBubble.tsx` остаётся оркестратором на прежнем пути (импорт из MessageList не тронут), Props и JSX без изменений. Код перенесён дословно. Сборка (strict tsc + vite) зелёная, приложение грузится без ошибок консоли.

- 2026-06-18 | refactor/backend | `chatService.js` (937 строк) разбит на `services/chat/*.js` по областям: `queries` (getChatById/getUserChats — общий read-слой), `create`, `prefs` (pin/mute/order), `members` (участники/роли/жизненный цикл/инфо группы), `teardown` (удаление ЛС/аккаунта), `backgrounds`. `chatService.js` теперь barrel — реэкспортит те же 20 имён, внешние импортёры (routes/chats, users, socketServer) не тронуты. Цикла нет (chat/* → messageService/userService/chatPermissions в одну сторону). Все 88 тестов зелёные, экспортируемый API идентичен.

- 2026-06-18 | refactor/css | `app.css` (13.5k строк, монолит) разбит на 18 модулей `web/src/styles/*.css` (`01-tokens-auth-layout` … `18-aurora-overrides`). `app.css` теперь barrel: только `@import` шрифта и модулей в ИСХОДНОМ порядке (каскад сохранён). Безопасность правки доказана: конкатенация частей байт-в-байт совпала с оригиналом + у каждого файла сбалансированы `{}` (ни одно правило/@media не разрезано). Сборка зелёная (CSS-бандл тот же), экран входа рендерится стилизованно. Поведение/внешний вид не изменены.

- 2026-06-18 | security | аудит #5 (последний пункт): закрыт cross-chat IDOR в реакциях. `toggleReaction`/`toggleEmojiReaction` искали сообщение только по id — участник одного чата мог поставить реакцию на сообщение из ЧУЖОГО чата, зная его UUID (роут проверял членство лишь в `chatId` из URL). Теперь обе функции принимают `chatId` и скоупят SELECT/UPDATE по `chat_id` (+ `deleted_at IS NULL`), как уже делал `pinMessage`. +4 теста (88). **Все 5 пунктов аудита безопасности закрыты.**

- 2026-06-18 | security | аудит #4: токен админ-панели больше не бессрочный. `/admin/api/login` подписывал JWT без `expiresIn` → жил вечно (отзыв только через таблицу sessions). Теперь `expiresIn: '12h'`; по истечении любой запрос отдаёт 401 → панель сама делает logout на экран входа (поведение `public/admin/admin.js` уже было, фронт не трогали). +2 теста (84).

- 2026-06-18 | security | аудит #3: TOTP-секреты больше не хранятся открытым текстом. `users.totp_secret`/`totp_pending_secret` шифруются (AES-256-GCM, `utils/totp.encryptSecret`, маркер `enc:v1:`) ДО записи — доступ к .db/бэкапу не даёт генерировать 2FA-коды. Секрет нельзя хешировать (нужен для расчёта кодов), поэтому обратимое шифрование тем же ключом, что и сообщения. Роуты используют `verifyTotp` (дешифрует и проверяет; legacy-плейнтекст работает прозрачно). Миграция 011 дошифровывает существующие секреты (идемпотентна). +4 теста (82). Резервные коды и так были bcrypt-хешированы — не трогали.

- 2026-06-18 | security | аудит #2: бэкапы БД в S3 шифруются на уровне приложения (AES-256-GCM, `utils/backupCrypto.js`) ПЕРЕД загрузкой — теперь доступ к ключам/бакету S3 не раскрывает содержимое (SSE не помогал бы: провайдер расшифровывает на GET). Ключ: `DB_BACKUP_ENCRYPTION_KEY` или HKDF-производный от `MESSAGE_ENCRYPTION_KEY` (шифрование всегда вкл., без доп. настройки). Опц. отдельный бакет/креды бэкапов (`DB_BACKUP_S3_BUCKET`/`_ACCESS_KEY_ID`/`_SECRET_ACCESS_KEY`). Объекты → `*.db.enc`; восстановление — `scripts/restore-backup.js` (`npm run restore-backup`, флаги `--list`/`--s3`, понимает и legacy-плейнтекст). Контейнер: `magic(5)+iv(12)+tag(16)+ct`, тампер ловится GCM. +5 тестов (78). ОСТАТОК для оператора: старые незашифрованные `.db`-бэкапы в S3 удалить вручную (иначе истекут за ≤30 дней через pruneOldBackups).

- 2026-06-18 | security | закрыта критическая дыра из аудита: открытый текст сообщений at-rest. Колонка `messages.search_text` и таблица FTS5 `messages_fts` хранили cleartext рядом с шифром — любой доступ к .db/бэкапу = вся переписка открытым текстом. Теперь: (1) поиск — дешифровкой кандидатов в памяти `messageService.searchMessages` (substring, новые-первыми, cap 5000/20); search.js переписан, контракт ответа не изменён (фронт не трогали); (2) вкладка «ссылки» — флаг `messages.has_link` вместо `LIKE %http%`; (3) миграция 010: бэкфилл has_link дешифровкой → дроп триггеров+таблицы FTS → затирание и DROP COLUMN search_text. Тесты delete/edit переписаны на новую модель + блок «no plaintext at rest» (скан всех колонок) + searchMessages/has_link/изоляция по членству. +4 теста (73)

- 2026-06-18 | chat | (1) надёжный фон «для всех»: причина «не работает у части юзеров» — личный фон (my_chat_bg) всегда перекрывал общий, в т.ч. у самого автора. Теперь setChatBackground(forEveryone) снимает личный фон автора (видит результат сразу) + ставит chats.chat_bg_updated_at (миграция 009). Участнику с СВОИМ личным фоном общий не затирается молча — плашка SharedBgPrompt «Фон чата обновлён · Применить» (показ по chat_bg_updated_at > my_chat_bg_updated_at; дисмисс в localStorage). +2 теста (69). (2) даты в переписке: разделители дня (Сегодня/Вчера/«17 января»/«11 июля 2025») в MessageList + плавающая sticky-пилюля даты сверху при прокрутке (format.ts: dayKey/formatDateSeparator)

- 2026-06-12 | groups+chat | индивидуальные фоны чата (этап 2/2): миграция 008 (chats.chat_bg + таблица chat_backgrounds), ChatBg=solid/gradient/image; setChatBackground (личный/общий: ЛС — любой, группа — edit_info), PUT /chats/:id/background, подпись image-url в s3Sign; фронт — ChatBackgroundModal (пресеты/цвет/градиент/картинка/«для всех»), --chat-bg на .chatArea (личный→общий→app-bg→дефолт), пункт «Фон чата» в меню шапки; upsertChat сохраняет локальный my_chat_bg (общий фон не «протекает»). +8 тестов (всего 67)

- 2026-06-12 | groups | гранулярные права модератора (этап 1/2 фич групп): миграция 007 (chat_members.permissions JSON), модуль services/chatPermissions.js (единый источник прав, без цикла require), гейты edit_info→updateChatMetadata, delete_messages→deleteMessages, manage_members→add/removeMember; роут PATCH /chats/:id/members/:userId/permissions (admin-only); UI диалог прав в GroupInfoModal (3 переключателя). Дефолт модератора сохраняет старое поведение. +6 тестов (всего 59)

- 2026-06-12 | ci+tests | CI-гейт перед деплоем: .github/workflows/deploy-amvera.yml теперь job `test` (backend npm test + web build) → `deploy` зависит от него (needs) и идёт только при push в devDK; на PR гоняются только тесты. +6 тестов прав доступа к чатам (посторонний не читает/не пишет/не пересылает в чужой чат) — всего 53; в тестовую схему messages добавлены колонки is_delivered/deliver_at/voice_waveform

- 2026-06-11 | security | access-токен вынесен из localStorage в память (storage/session.ts): XSS больше не может прочитать готовый bearer. Auth идёт через httpOnly session-cookie (primary) + in-memory bearer (cross-origin fallback), refresh-токен остаётся в localStorage (cookie может блокироваться сторонними). Гонка multi-tab refresh закрыта cross-tab локом (Web Locks) в api/client.ts; socketClient рефрешит и при 'No token'. Легаси blizkie.token.v1 чистится при старте

- 2026-06-11 | security | серверный хардненинг: CSRF-проверка Origin на мутациях (middleware/csrfOrigin.js, defense-in-depth поверх CORS), CORS-блок теперь отдаёт чистый 403 вместо 500, blanket rate-limit входящих socket-событий (50/сек на сокет, socket.use), nosniff+attachment на отдаче /uploads; +6 тестов (всего 47)

- 2026-06-10 | security | устранён хранимый XSS в результатах поиска сообщений: UserSearch.highlightSnippet рендерит сниппет через React (<mark>) вместо dangerouslySetInnerHTML — чужой текст сообщения больше не исполняется как HTML

- 2026-06-10 | css+socket | контент исходящих пузырей (иконки файлов, «переслано от», цитаты) переведён на currentColor — читаем на любом акценте; фикс сокета: auth-функция отдаёт свежий JWT на каждом реконнекте, refresh протухшего токена до handshake и при «Invalid token» (раньше — вылет на логин), реконнекты Infinity (холодный старт Amvera), loadChats при реконнекте переподписывает S3-аватарки

- 2026-06-10 | ui+api | вкладка «Внешний вид»: выбор фона приложения (пресеты/свой цвет/градиент с углом); utils/appBackground.ts + --app-bg на .layout; задел --chat-bg на .chatArea под per-chat фоны; синк между устройствами: миграция 006 (users.app_bg JSON), PATCH /users/me, применяется при входе; +5 smoke-тестов

- 2026-06-10 | css+ui | «Аврора 2.0»: стеклянные панели, градиентные пузыри с авто-контрастом, группировка серий сообщений, круглые аватары, плавающий композер, микро-анимации (reduced-motion учтён); весь дизайн вычисляется от --accent (выбор акцента в настройках перекрашивает всё); accent.ts: дефолт сменён со старого синего на #8e75f2
- 2026-06-10 | docs | создан этот файл (CLAUDE.md) — карта проекта и журнал
- 2026-06-10 | css | редизайн «Аврора»: новая палитра/токены, Manrope, градиенты, слой полировки в конце app.css (24f4cb86)
- 2026-06 (ранее) | auth | серия фиксов WebAuthn/passkeys под simplewebauthn v9 (af632f90…cbb10504)
