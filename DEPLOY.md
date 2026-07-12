# Деплой Blizkie — инструкция

Архитектура продакшена:

- **Backend** — [Amvera](https://amvera.ru) (Docker, постоянный том `/data` под SQLite). Конфиг — `amvera.yaml` + `Dockerfile`.
- **Frontend** — [Vercel](https://vercel.com) (сборка из исходников `web/`, SPA-rewrite в `web/vercel.json`).
- **Хранилище медиа** — S3-совместимое (Yandex Object Storage).
- **CI** — `.github/workflows/deploy-amvera.yml`: на push в `devDK` сначала прогоняются тесты (`backend npm test` + `web build`), затем деплой. На PR — только тесты.

> Рабочая ветка — `devDK`, основная — `main`.

---

## 1. Frontend (Vercel)

**Root Directory:** `web` · **Build Command:** `npm run build` · **Output Directory:** `dist`

Переменные окружения (**Settings → Environment Variables**):

| Переменная           | Значение                                  |
|----------------------|-------------------------------------------|
| `VITE_API_BASE_URL`  | URL бэкенда на Amvera, напр. `https://blizkie-backend.amvera.io` |
| `VITE_SOCKET_URL`    | то же, что `VITE_API_BASE_URL`            |
| `VITE_SENTRY_DSN`    | (опц.) DSN проекта на sentry.io — включает отправку ошибок фронтенда. DSN клиента Sentry не секрет (предназначен для публичных бандлов), можно смело класть в `VITE_*` |

> ⚠️ `VITE_*` попадают в публичный бандл — **никаких секретов**. После изменения переменных — **Redeploy** (старая сборка иначе продолжит использовать прежние значения).

---

## 2. Backend (Amvera)

Деплой по `amvera.yaml` (Docker, `containerPort: 3000`, `persistenceMount: /data`). Переменные задаются в панели Amvera.

### Обязательно всегда
| Переменная                 | Значение |
|----------------------------|----------|
| `JWT_SECRET`               | длинная случайная строка (≥32 симв.) |
| `MESSAGE_ENCRYPTION_KEY`   | 64 hex-символа (32 байта) — ключ AES шифрования сообщений. **Потеря = потеря всей переписки** |

### Обязательно в production (`NODE_ENV=production`)
| Переменная             | Значение |
|------------------------|----------|
| `SMTP_HOST`            | хост SMTP (OTP, сброс пароля) |
| `ADMIN_PASSWORD_HASH`  | bcrypt-хэш пароля админа (`npm run create-admin` помогает) |
| `APP_URL`              | публичный URL фронтенда (для ссылок в письмах / invite) |

### Рекомендуется
| Переменная        | Назначение |
|-------------------|------------|
| `NODE_ENV`        | `production` |
| `DB_PATH`         | `/data/blizkie.db` (том Amvera) |
| `ALLOWED_ORIGIN`  | origin фронтенда (CORS), можно список через запятую |
| `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | параметры почты |
| `ADMIN_USERNAME`  | логин админ-панели |

### Опциональные группы (по фичам)
- **Медиа (S3):** `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_PUBLIC_URL` (+ опц. `S3_REGION`, `S3_ENDPOINT`). Без них — загрузка падает на локальный диск. Загрузка с привязкой размера: `UPLOAD_PRESIGN_POST=true` (требует `POST` в CORS-политике бакета).
- **Push:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`.
- **Звонки (WebRTC):** `STUN_URLS`, и TURN — либо `METERED_API_KEY`/`METERED_TURN_SECRET`, либо `TURN_URL(S)`/`TURN_USERNAME`/`TURN_CREDENTIAL`.
- **WebAuthn / passkeys:** `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`.
- **ИИ-ассистенты / сводки:** `AI_SUMMARY_*`, `AI_ASSISTANT_*`, `AI_DATA_*` (см. CLAUDE.md).
- **GIF:** `GIPHY_API_KEY`.
- **Error tracking (Sentry):** `SENTRY_DSN` (опц.) — без него `utils/sentry.js` полностью неактивен (как и все опциональные фичи). Ошибки уходят анонимно: тело запроса/куки/`Authorization` вырезаются до отправки (`scrubEvent`), к пользователю привязывается только внутренний ID (не email/username) — см. §6 `docs/STORE_LAUNCH_TZ.md`.
- **Бэкапы БД в S3:** включены всегда (ключ — `DB_BACKUP_ENCRYPTION_KEY` либо HKDF от `MESSAGE_ENCRYPTION_KEY`); опц. изоляция `DB_BACKUP_S3_BUCKET`/`_ACCESS_KEY_ID`/`_SECRET_ACCESS_KEY`, расписание `DB_BACKUP_HOUR_UTC`, хранение `DB_BACKUP_KEEP_DAYS`. Восстановление — `npm run restore-backup -- <файл|--s3 ключ> [out.db]`.
- **Удаление аккаунта («Удалённый аккаунт»):** опц. `DELETED_ACCOUNT_RETENTION_DAYS` (по умолчанию 180) — через сколько дней воркер `workers/deletedAccountCleanup.js` удаляет сообщения/звонки, унаследованные аккаунтом-заглушкой при удалении реальных аккаунтов.

> Подробнее по группам и фичам — `CLAUDE.md` (карта проекта) и `ROADMAP.md`.

---

## 3. Структура проекта

```
messenger-web/
├── backend/          → Node.js / Express / Socket.io / better-sqlite3
│   ├── src/
│   ├── Dockerfile    → образ для Amvera
│   └── package.json
├── web/              → React / Vite / TypeScript
│   ├── src/
│   ├── vercel.json   → SPA-rewrite (фикс reload → 404)
│   └── package.json
├── amvera.yaml       → конфиг деплоя бэкенда (Docker, том /data, порт 3000)
└── .github/workflows/deploy-amvera.yml → CI: тесты → деплой на push в devDK
```

---

## 4. Чек-лист первого деплоя

1. Завести S3-бакет (приватный) + CORS (`GET, PUT, HEAD, POST`, нужные origin'ы).
2. Сгенерировать `MESSAGE_ENCRYPTION_KEY` (64 hex) и `JWT_SECRET` — **сохранить надёжно**.
3. Внести env на Amvera (раздел 2) и на Vercel (раздел 1).
4. Запушить в `devDK` → CI прогонит тесты и задеплоит бэкенд; Vercel соберёт фронт.
5. Проверить `/health`, вход/регистрацию (придёт ли OTP), отправку медиа.
