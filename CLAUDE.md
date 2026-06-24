# Blizkie Messenger («мои близкие») — карта проекта для ИИ-агентов

Этот файл — главный ориентир по проекту. Прочитав его, агент должен понимать структуру
без дополнительного исследования. **Правила работы с файлом — в конце.**

> **Планы/ТЗ на будущие фичи** (онбординг, invite-token, два ИИ-ассистента, deep-links) —
> в `ROADMAP.md` рядом с этим файлом. Если задача про развитие — сперва прочти его.

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
  db/versions/      # миграции 001–013 (вся схема БД здесь; новая таблица = новый файл миграции)
  middleware/       # auth.js (JWT), errorHandler.js, rateLimits.js, csrfOrigin.js (Origin-проверка мутаций)
  routes/           # 23 файла — REST API, имя файла = префикс (auth, users, chats, messages, upload,
                    #   admin, friends, support, polls, push, search, sessions, linkPreview,
                    #   sticker-packs, gif, totp, calls, notes, dailyPrompts, folders, health, export,
                    #   webauthn, assistant).
                    #   assistant.js — ассистент-помощник: GET /assistant/status (вкл/выкл),
                    #     POST /assistant/ask {question,kb}→{reply,covered,relatedIds}
                    #     (LLM генерирует ответ по присланной базе знаний).
                    #   dailyPrompts.js — «Вопрос дня» (под /chats/:id/daily-prompt): конфиг, свои
                    #     вопросы, архив инстансов, ответы (текст/гс/кружок/медиа), ask-now.
                    #   invites.js — invite-token (постоянная личная ссылка): /invites/me (+QR),
                    #     /:token/resolve (публ.), /:token/accept (друзья+ЛС); сервис inviteService.
                    #   admin.js — оркестратор: login + auth+isAdmin + монтирует под-роутеры
                    #     admin/* (stats, users, chats, moderation, stickerRepair, diagnostics);
                    #     публичные URL не менялись.
  services/         # бизнес-логика, вызывается из routes
                    #   chatService.js — barrel; реализация в services/chat/*.js
                    #   (queries — getChatById/getUserChats; create; prefs — pin/mute;
                    #    members — участники/роли/группа; teardown — удаление; backgrounds)
                    #   dailyPromptService.js — логика «Вопроса дня» (конфиг, выбор вопроса
                    #     «мешком», доставка по поясу чата, стрик, ответы); dailyPromptBank.js — банки.
                    #   assistantService.js — LLM-генератор ответа помощника (этап C): по вопросу
                    #     + присланной базе знаний формулирует ответ строго по ней (covered/
                    #     relatedIds, кнопки резолвит фронт → deep-links валидны); in-memory кэш;
                    #     провайдер от AI-сводки, env AI_ASSISTANT_* (фолбэк AI_SUMMARY_*, Groq).
  socket/socketServer.js  # весь realtime: new-message, typing, presence, call:* (сигналинг WebRTC);
                    #   intervals: отложенные сообщения + «Вопрос дня» (рассылка по расписанию)
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
  store/            # 10 Zustand-сторов: useSessionStore (auth), useChatsStore (чаты+сообщения),
                    #   useAppStore (UI/тема), useCallStore, useStickerStore, useGifStore,
                    #   useDraftStore, useNotesStore, useFolderStore, useDeepLinkStore (deep-links)
  deeplinks.ts      # модель «ссылок-действий» (blz:<type>?k=v): типы+parse+shareApp.
                    #   Раннеры: глобальные — в App.tsx, чат-привязанные — в ChatArea.
                    #   Среди действий: assistant?topic= и support (открыть помощника/поддержку)
  assistant/faq.ts  # база знаний ассистента-помощника (Этап C): типизированный реестр
                    #   интентов (вопрос/ключевые слова/ответ-markdown/кнопки-deep-links)
                    #   + searchFaqScored (порог FAQ_SCORE_STRONG, локальный фолбэк без ИИ),
                    #   getIntentById, ASSISTANT_KB (база для LLM-генератора), TOP_INTENTS/CATEGORY_META.
                    #   ЕДИНЫЙ источник «как сделать X» — обновлять при изменении фич (иначе FAQ устареет)
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
                    #   «Вопрос дня»: DailyPromptCard.tsx — карточка в ленте (отдельная ветка в
                    #     MessageList, не через MessageBubble); DailyPromptThreadModal.tsx — тред
                    #     ответов + архив (ввод ответа = переиспользованный Composer)
                    #   Composer.tsx — крупный (запись голоса/видео-кружков, стейт-машина в нём же);
                    #     чистые куски вынесены в chat/composer/* (helpers, icons, PreviewPlayer)
    modals/         # все модалки (группы, пересылка, медиа, настройки профиля и т.д.).
                    #   AssistantModal.tsx — ассистент-помощник (Этап C): диалоговый FAQ
                    #     поверх assistant/faq.ts; флаг useAppStore.showAssistant.
                    #   SupportModal.tsx — техподдержка; флаг useAppStore.showSupport (обе
                    #     модалки монтируются в App.tsx, открываются из сайдбара/ассистента/deep-link).
                    #   ChatSettingsModal.tsx — хаб «Настройки чата» (меню шапки): секции
                    #     «Оформление» (ChatBackgroundSettings — вынесенный контент фон-модалки) +
                    #     «Вопрос дня» (modals/chatSettings/DailyPromptSection + helpers). Не для saved.
                    #   ChatBackgroundModal.tsx — тонкая обёртка над ChatBackgroundSettings (legacy-вход).
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
- **Репозиторий публичный** (Vercel Hobby тянет фронт). Секреты — ТОЛЬКО в env (Amvera/Vercel), никогда в коде/`VITE_*` (последние попадают в публичный бандл). Защита от случайного слива: pre-commit хук в `.githooks/` (блокирует `.env`/`.db`/`node_modules`/похожее-на-ключ). **Активация на каждый клон:** `git config core.hooksPath .githooks`. Использует gitleaks, если установлен.

## Как работать с этим файлом (инструкция агенту)

1. **Перед задачей** — сориентируйся по таблице «Типовые задачи», не сканируй проект целиком.
2. **После каждой содержательной задачи** — добавь ОДНУ строку в журнал ниже (новые сверху):
   `ДАТА | область | что сделано (+ хеш коммита)`. Кратко, без воды.
3. **Если структура изменилась** (новая папка, новый стор, новый роут) — обнови соответствующий
   раздел выше, а не только журнал.
4. Журнал держать не длиннее ~40 строк: старые записи группировать в одну строку-сводку.

## Журнал изменений

- 2026-06-24 | feature/fullstack | Ассистент: LLM теперь ГЕНЕРИРУЕТ ответ по базе знаний (а не выбирает готовый интент). Причина жалобы «дефолтные ответы не по теме»: уверенные ответы давал локальный поиск по ключевым словам, а LLM-маршрутизатор только выбирал интент/ничего. Переделано: backend `assistantService.answerQuestion(question, kb)` шлёт вопрос + базу знаний (вопрос/ответ/labels кнопок) модели (Groq llama-3.3-70b, env AI_SUMMARY_*), та формулирует ответ СТРОГО по базе и возвращает `{reply, covered, relatedIds}` (JSON-mode, temp 0.3, in-memory кэш 1ч). Не покрыто базой → `covered=false` → честный ответ + поддержка (без галлюцинаций). Кнопки-навигации фронт резолвит сам по `relatedIds` → deep-links всегда валидны. Роут `POST /assistant/ask {question,kb}`. Фронт: при включённом ИИ свободный вопрос ВСЕГДА идёт в генератор (локальный STRONG-матч больше не перехватывает), новый тип сообщения `assistant-generated`; нет ИИ → локальный фолбэк. `faq.ts`: `ASSISTANT_KB`. Проверено на реальном Groq: «сменить номер телефона»/«язык интерфейса» → честно «нет такого», «голосовое маме» → ответ + кнопка. +1 тест переписан (109), сборка зелёная.

- 2026-06-24 | fix/pwa | Деплои не доходили до пользователей: SW (`src/sw.ts`) не вызывал `skipWaiting()` — новая версия зависала в "waiting" и не активировалась, пока открыта хоть одна вкладка; reload отдавал старый закэшированный бандл (выглядело как «ничего не поменялось» после пуша). Добавлен `self.skipWaiting()` (+ уже был `clients.claim()` в activate) → свежая сборка подхватывается на следующем reload без ручной очистки кэша. Разовая особенность: текущий «застрявший» старый SW без skipWaiting обновится только после полного закрытия всех вкладок/PWA один раз; дальше — авто.

- 2026-06-24 | fix/web | Ассистент: устранены неверные ответы локального поиска. Причина — скоринг матчил по ОБЩИМ словам вопроса («удалить **аккаунт**» → «защитить **аккаунт**», «**сменить** номер» → «**сменить** тему»). Переписан `searchFaqScored`: стоп-слова + лёгкий стеммер (рус. окончания) + матч ТОЛЬКО по ключевым словам интента даёт уверенный ответ (`FAQ_SCORE_STRONG`), общие слова вопроса — лишь слабый сигнал для подсказок. Расширена база под реальные настройки (приложение по email, без телефона): новые интенты `change-name`/`change-email`/`delete-account`/`phone` (+усилены keywords security/privacy). Теперь «удалить аккаунт», «сменить почту/имя», «номер телефона» отвечаются верно; нерелевантное → честный фолбэк. Сборка зелёная; все проблемные запросы проверены в preview. (Полноценное понимание свободных формулировок — LLM-слой, включается env-ключом `AI_ASSISTANT_*`/`AI_SUMMARY_*`.)

- 2026-06-24 | feature/fullstack | Ассистент-помощник v2 (порог релевантности + LLM-маршрутизатор). Фикс «спонтанных ответов не по теме»: `faq.ts` теперь `searchFaqScored` с порогами `FAQ_SCORE_STRONG/WEAK` — уверенное совпадение отвечает сразу, слабое → «возможно, вы имели в виду…» (топ-3 чипа-подсказки), пусто → честный фолбэк на поддержку (раньше всегда `results[0]`). LLM как МАРШРУТИЗАТОР (не генератор): backend `services/assistantService.js` + `routes/assistant.js` (`GET /assistant/status`, `POST /assistant/ask {question,intents}`, rate-limit 20/мин), провайдер переиспользован от AI-сводки (env `AI_ASSISTANT_*` с фолбэком `AI_SUMMARY_*`). LLM выбирает один id из присланного каталога `INTENT_CATALOG`, id жёстко валидируется по каталогу (ноль галлюцинаций, кнопки всегда валидны), фронт показывает выверенный ответ + «печатает…». Деградирует мягко: нет ключа → порог без ИИ. Фронт: `api/assistant.ts`, флоу в AssistantModal. +5 backend-тестов (108), сборка strict tsc+vite зелёная; все пути (strong→ответ, off-topic→фолбэк, weak→подсказки→ответ) проверены в preview. Этап C закрыт (v1+v2). Остаток — Этап D.

- 2026-06-24 | feature/web | Ассистент-помощник (Этап C, v1 — детерминированный FAQ). Диалоговая модалка `modals/AssistantModal` поверх типизированной базы знаний `assistant/faq.ts` (~20 интентов: вопрос/ключевые слова/ответ-markdown/кнопки-deep-links; `searchFaq` ранжирует по словам). UX: приветствие → категории + чипы частых вопросов → поиск; ответ = карточка (markdown + кнопки-действия); нет ответа → «написать в поддержку». Кнопка диспатчит deep-link и закрывает ассистента. Новые deep-links `assistant?topic=` + `support` (deeplinks.ts + раннер App.tsx). SupportModal поднят в глобальный стор (`useAppStore.showSupport/showAssistant`), монтируется в App.tsx; Sidebar/SidebarBottom — новый пункт «Помощник» (поддержка теперь через стор). Онбординг: CTA «Спросите помощника». Стили `asst*` в слой «Аврора». Без ИИ/backend (v2 LLM — задел). Сборка strict tsc+vite + 103 backend-теста зелёные; флоу (чип→ответ, поиск→ответ «кружок», действие→invite deep-link + закрытие) проверен в preview. Остаток — Этап D (ассистент по данным).

- 2026-06-24 | feature/fullstack | Авто-посев «Избранного» (завершение этапа A). `services/chat/create.seedSavedWelcome` — при первом создании saved-чата (`getOrCreateSavedChat`) сеет 3 приветственных сообщения (обычные, не системные, от самого юзера) с кликабельными `blz:`-deep-links (Пригласить/Найти друзей/Создать группу/Оформление). Идемпотентно (только в ветке создания). Новый deep-link `open-saved` (deeplinks.ts + раннер App.tsx: создаёт/находит «Избранное» и открывает) — кнопка «Как пользоваться» в OnboardingWelcome ведёт туда. +1 тест (103). Проверено в preview: новый юзер → «Как пользоваться» → «Избранное» с приветствием, клик по ссылке открывает InviteModal. Этап A закрыт полностью.

- 2026-06-24 | fix/web | Запоминание последнего чата + устойчивый приём приглашения. Баг «всегда открывается первый чат»: `useChatsStore.loadChats` авто-выбирал `list[0]` — убрано. Теперь `setActiveChatId` пишет `localStorage blz.lastChat={id,ts}`, а `loadChats` восстанавливает последний чат только если метка свежее 15 мин и чат существует; иначе — общий список (нет активного чата). Приём `?invite=`: переписан на устойчивый (App.tsx) — токен в sessionStorage + чистка URL сразу, accept с ретраем (404 → не повторять, иначе оставить токен), без молчаливого перетягивания на старый чат. Backend `routes/invites.buildLink`: Origin вызывающего фронта приоритетнее APP_URL (ссылка ведёт на приложение, не на API). Проверено в preview: чистый логин не открывает чат; открытие→reload восстанавливает; >15мин→список; `?invite=` открывает верный ЛС и чистит URL.

- 2026-06-24 | feature/fullstack | Invite-token (этап B) — двигатель роста. Постоянная личная многоразовая ссылка + QR. Backend: миграция 013 `invite_tokens`, `services/inviteService.js` (getOrCreateMyToken/regenerate/resolve/accept; accept = мгновенно друзья + создать/найти ЛС, namеренно без getChatById для тестируемости), `routes/invites.js` (resolve публичный; me/regenerate/accept под auth; QR через `qrcode`; обогащение чата + socket `chat-created` пригласившему в роуте), монтаж `/invites` в index.js. Фронт: `api/invites.ts`, `modals/InviteModal` (ссылка/QR/копировать/поделиться/счётчик/обновить), вход из меню профиля (SidebarBottom «Пригласить друзей») и онбординга (CTA → deep-link `invite`), флаг `useAppStore.showInvite`. Приём `?invite=` в App.tsx (залогинен→accept+ЛС; гость→баннер на AuthScreen + accept после входа). +4 backend-теста (102 зелёных), сборка strict tsc+vite зелёная; полный флоу (создать/resolve/accept) проверен на реальной БД + InviteModal в preview. v1 = постоянная личная / сразу друзья / только ЛС (детали и остаток — ROADMAP).

- 2026-06-24 | feature/web | Deep-links (фундамент) + онбординг (этап A). Deep-links: `deeplinks.ts` (тип `DeepLinkAction`, `parseDeepLink('blz:<type>?k=v')`, `isChatScoped`, `shareApp`) + `store/useDeepLinkStore` (pending/open/consume). Глобальные действия — раннер-эффект в `App.tsx` (open-chat/profile-settings/appearance/create-group/find-friends→фокус `#blzSearch`/invite→Web Share); чат-привязанные — раннер в `ChatArea` (chat-settings+section/daily-archive/notes/media: переключает чат и открывает панель). `blz:`-ссылки кликабельны в `markdown.tsx`. `ChatSettingsModal` теперь принимает initialSection из deep-link. Онбординг: `chat/OnboardingWelcome` (приветствие + 6 карточек-фич + CTA через deep-links/share) рендерится из `EmptyState`, когда нет реальных чатов (кроме saved). Стили `onb*`/`bubbleActionLink` в слое «Аврора». Сборка strict tsc+vite зелёная; онбординг проверен в preview (рендер + CTA). Подробности и остаток (опц. авто-посев «Избранного») — в ROADMAP. Бэкенд не затронут.

- 2026-06-22 | feature/web | «Вопрос дня» (этап 3/3 — лента + тред). Карточка-вопрос в ленте: `chat/DailyPromptCard` (рендерится отдельной веткой в `MessageList` для `is_system && attachment_type==='daily_prompt'`, НЕ через MessageBubble). Тред/архив: `chat/DailyPromptThreadModal` (один компонент, 2 режима: instanceId→тред, null→архив); ответы рендерятся плеерами из `messageBubble/*`, ввод ответа (текст/гс/кружок/медиа) — переиспользованный `Composer` (только value/onChange/onSend/onSendAttachment → чат-фичи скрыты). Backend: `getChatMessages` обогащает daily_prompt-сообщения полем `daily_prompt{instance_id,answer_count}` (как опросы). Realtime: `useSocket` слушает `daily-prompt-answer`/`-deleted` → обновляет счётчик карточки в сторе + шлёт window-событие в открытый тред. Превью в списке чатов — «🌙 Вопрос дня» (ChatItem). Тип `Message.daily_prompt` добавлен. Архив открывается и с карточки, и из секции настроек (onOpenArchive). Проверено локально (стенд на отдельной БD): карточка из сокета и из истории, открытие треда, live-ответ от второго юзера, live-счётчик «1 ответ», стрик. Сборка strict tsc+vite + 98 backend-тестов зелёные. Фича завершена (этапы 1-3).

- 2026-06-22 | feature/web | «Вопрос дня» (этап 2/3 — UI настроек). Новый хаб `ChatSettingsModal` (меню шапки «Фон чата» → «Настройки чата», иконка-шестерёнка; скрыт для saved). Секции: «Оформление» (контент фон-модалки вынесен в `ChatBackgroundSettings`, `ChatBackgroundModal` стал тонкой обёрткой — внешний API не сломан) + «Вопрос дня» (`modals/chatSettings/DailyPromptSection` + `helpers`: вкл/время/пояс/расписание daily-weekdays-weekly/банки/свои вопросы/порядок/push/«задать сейчас»/стрик; черновик + кнопка «Сохранить» с dirty-трекингом; read-only без права edit_info). API-обёртка `api/dailyPrompts.ts` (конфиг+вопросы+ask-now+архив+ответы). CSS — в слой «Аврора» (cs*/dp*). ChatArea: `showChatBg`→`showChatSettings`, lazy `ChatSettingsModal`. Сборка strict tsc+vite зелёная. Осталось (этап 3): рендер карточки `daily_prompt` в MessageBubble + экран-тред ответов (гс/кружки/медиа) + socket-подписки.

- 2026-06-22 | feature/backend | «Вопрос дня» (этап 1/3 — backend). Миграция 012: `chat_daily_prompts` (конфиг: вкл/время/пояс/расписание/источник/мешок/push), `chat_daily_prompt_questions` (свои вопросы), `daily_prompt_instances` (заданные вопросы = архив; текст в шифре), `daily_prompt_answers` (ответы текст/гс/кружок/медиа — attachment-колонки как у messages). Сервис `dailyPromptService` + банк `dailyPromptBank` (6 тем). Карточка-вопрос = сообщение `attachment_type='daily_prompt'` (переиспользует broadcast/push/пагинацию), ответы — отдельная таблица/тред, в ленту не попадают. Стрик = подряд идущие отвеченные дни (pending-сегодня не сбрасывает). Права управления = как общий фон (edit_info; ЛС оба). Доставка — новый `setInterval` (60с) в socketServer по поясу чата, идемпотентно/день. Роут `routes/dailyPrompts.js` под `/chats/:id/daily-prompt`. +10 тестов (98). UI (хаб «Настройки чата» + карточка + тред) — следующие этапы. Плейнтекста at-rest нет.

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
