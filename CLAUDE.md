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
                    #   sticker-packs, gif, totp, calls, notes, folders, health, export, webauthn)
  services/         # бизнес-логика, вызывается из routes
  socket/socketServer.js  # весь realtime: new-message, typing, presence, call:* (сигналинг WebRTC)
  utils/            # jwt, s3 (подпись ссылок), otp, logger
  workers/          # dbBackup.js (бэкап БД в S3), s3Cleanup.js
backend/tests/smoke.test.js   # node --test; запуск: cd backend && npm test

web/src/
  app.css           # ВСЕ стили в одном файле (~13k строк), CSS-переменные в :root (dark)
                    #   и :root[data-theme="light"]; слой переопределений «Аврора» — В КОНЦЕ файла
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
    chat/           # ChatArea, MessageList, MessageBubble, Composer, панель эмодзи/стикеров, опросы
    modals/         # все модалки (группы, пересылка, медиа, настройки профиля и т.д.)
    profile/        # вкладки настроек (профиль, пароль, приватность, сессии, passkeys...)
    call/           # IncomingCallModal, CallOverlay
    ui/             # переиспользуемые: Avatar, ContextMenu, Toggle, Portal, icons/
  services/webrtcManager.ts  # WebRTC peer connection звонков
  utils/            # theme.ts (тема), accent.ts (акцент пользователя), appBackground.ts (фон
                    #   приложения: solid/gradient через --app-bg; модель AppBg переиспользовать
                    #   для будущих per-chat фонов через --chat-bg на .chatArea), format.ts, push.ts
```

## Типовые задачи — куда лезть (для экономии токенов)

| Задача | Файлы |
|---|---|
| Изменить внешний вид / цвета / шрифты | только `web/src/app.css`. Токены в `:root` вверху; точечные правки — в слой «Аврора» в конце файла. Не хардкодить цвета — использовать переменные |
| Новая кнопка/поведение в чате | `web/src/components/chat/` + при необходимости стор `useChatsStore` |
| Новый REST-эндпоинт | `backend/src/routes/<область>.js` (+ сервис) → обёртка в `web/src/api/<область>.ts` → вызов из компонента |
| Новое realtime-событие | `backend/src/socket/socketServer.js` → emit в `web/src/socket/socketClient.ts` → подписка в `web/src/hooks/useSocket.ts` |
| Изменение схемы БД | новый файл в `backend/src/db/versions/` (миграции нумерованные, применяются автоматически при старте) |
| Сообщения (отправка, реакции, пины, пересылка) | `backend/src/routes/messages.js`, `web/src/components/chat/MessageBubble.tsx`, `MessageList.tsx` |
| Звонки | `backend/src/routes/calls.js`, `socket/socketServer.js` (call:*), `web/src/services/webrtcManager.ts`, `useCallStore` |
| Загрузка файлов/медиа | `backend/src/routes/upload.js` (S3/Yandex Cloud), `web/src/components/chat/Composer.tsx` |

## Конвенции и грабли

- **Сообщения в БД зашифрованы** (AES-GCM): поля `ciphertext/iv/auth_tag`; поиск идёт по отдельному `search_text` (FTS5). Меняя логику сообщений — не забывать обновлять `search_text`.
- **Дизайн «Аврора»**: фиолетовый акцент `--accent`, градиент `--grad-accent` для главных кнопок, свечение `--glow`. Старый синий `#2f81f7` не возвращать.
- **simplewebauthn v9** — API именно девятой версии (см. коммиты cbb10504 и ранее), не обновлять вслепую.
- `web/dist/` в git частично устарел и игнорируется — **не коммитить**, Vercel собирает сам.
- `backend/data/*.db*` — локальная БД, **никогда не коммитить**.
- Backend не стартует без `JWT_SECRET` и `MESSAGE_ENCRYPTION_KEY`.
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

- 2026-06-11 | security | access-токен вынесен из localStorage в память (storage/session.ts): XSS больше не может прочитать готовый bearer. Auth идёт через httpOnly session-cookie (primary) + in-memory bearer (cross-origin fallback), refresh-токен остаётся в localStorage (cookie может блокироваться сторонними). Гонка multi-tab refresh закрыта cross-tab локом (Web Locks) в api/client.ts; socketClient рефрешит и при 'No token'. Легаси blizkie.token.v1 чистится при старте

- 2026-06-11 | security | серверный хардненинг: CSRF-проверка Origin на мутациях (middleware/csrfOrigin.js, defense-in-depth поверх CORS), CORS-блок теперь отдаёт чистый 403 вместо 500, blanket rate-limit входящих socket-событий (50/сек на сокет, socket.use), nosniff+attachment на отдаче /uploads; +6 тестов (всего 47)

- 2026-06-10 | security | устранён хранимый XSS в результатах поиска сообщений: UserSearch.highlightSnippet рендерит сниппет через React (<mark>) вместо dangerouslySetInnerHTML — чужой текст сообщения больше не исполняется как HTML

- 2026-06-10 | css+socket | контент исходящих пузырей (иконки файлов, «переслано от», цитаты) переведён на currentColor — читаем на любом акценте; фикс сокета: auth-функция отдаёт свежий JWT на каждом реконнекте, refresh протухшего токена до handshake и при «Invalid token» (раньше — вылет на логин), реконнекты Infinity (холодный старт Amvera), loadChats при реконнекте переподписывает S3-аватарки

- 2026-06-10 | ui+api | вкладка «Внешний вид»: выбор фона приложения (пресеты/свой цвет/градиент с углом); utils/appBackground.ts + --app-bg на .layout; задел --chat-bg на .chatArea под per-chat фоны; синк между устройствами: миграция 006 (users.app_bg JSON), PATCH /users/me, применяется при входе; +5 smoke-тестов

- 2026-06-10 | css+ui | «Аврора 2.0»: стеклянные панели, градиентные пузыри с авто-контрастом, группировка серий сообщений, круглые аватары, плавающий композер, микро-анимации (reduced-motion учтён); весь дизайн вычисляется от --accent (выбор акцента в настройках перекрашивает всё); accent.ts: дефолт сменён со старого синего на #8e75f2
- 2026-06-10 | docs | создан этот файл (CLAUDE.md) — карта проекта и журнал
- 2026-06-10 | css | редизайн «Аврора»: новая палитра/токены, Manrope, градиенты, слой полировки в конце app.css (24f4cb86)
- 2026-06 (ранее) | auth | серия фиксов WebAuthn/passkeys под simplewebauthn v9 (af632f90…cbb10504)
