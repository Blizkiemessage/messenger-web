# Техническое задание: Укрепление и развитие Blizkie Messenger

> **Версия:** 1.0  
> **Статус:** Действующее  
> **Ветка разработки:** `devDK`

---

## ЧАСТЬ 0. ОБЗОР ПРОЕКТА (читать первым делом)

### 0.1 Что такое Blizkie

Blizkie — веб-мессенджер с шифрованием сообщений, WebRTC-звонками, групповыми чатами, опросами, стикерами, медиа-вложениями и ролевой системой в группах. Проект находится в активной разработке, деплоится на Amvera (бэкенд) + Vercel (фронтенд).

### 0.2 Технологический стек

| Слой | Технология | Версия |
|---|---|---|
| **Runtime** | Node.js | 20+ |
| **Backend framework** | Express.js | 4.x |
| **Real-time** | Socket.IO | 4.x |
| **База данных** | SQLite (better-sqlite3) | 3.x |
| **ORM / Query** | better-sqlite3 (raw SQL) | — |
| **Шифрование** | AES-256-GCM (Node.js crypto) | встроенный |
| **Auth** | JWT (HS256) + bcrypt + TOTP | — |
| **Хранилище файлов** | Yandex S3 (опционально) | — |
| **Frontend** | React 19 + TypeScript | 19 / 5.x |
| **Сборщик** | Vite | 5.x |
| **State** | Zustand | 4.x |
| **HTTP client** | Axios | — |
| **UI** | Собственные компоненты + Bootstrap (admin) | — |
| **WebRTC** | нативный браузерный API | — |
| **Push** | Web Push API (VAPID) | — |
| **Deploy backend** | Amvera (Docker / Node.js) | — |
| **Deploy frontend** | Vercel (static) | — |

### 0.3 Структура репозитория

```
messenger-web/
├── backend/
│   ├── src/
│   │   ├── index.js               # Точка входа, middleware, routes
│   │   ├── config/
│   │   │   ├── database.js        # Инициализация SQLite, PRAGMA
│   │   │   └── email.js           # Nodemailer конфиг
│   │   ├── crypto/
│   │   │   └── aes.js             # AES-256-GCM encrypt/decrypt
│   │   ├── db/
│   │   │   └── migrations.js      # CREATE TABLE IF NOT EXISTS схемы
│   │   ├── middleware/
│   │   │   ├── auth.js            # JWT verify + session check
│   │   │   ├── errorHandler.js    # Глобальный обработчик ошибок
│   │   │   └── rateLimits.js      # express-rate-limit конфиги
│   │   ├── routes/
│   │   │   ├── auth.js            # Login, register, 2FA, email verify
│   │   │   ├── users.js           # Профиль, поиск, блокировка
│   │   │   ├── chats.js           # CRUD чатов, галерея, участники
│   │   │   ├── messages.js        # CRUD сообщений, реакции, ответы
│   │   │   ├── calls.js           # ICE servers, история звонков
│   │   │   ├── friends.js         # Заявки в друзья
│   │   │   ├── polls.js           # Опросы, голосование
│   │   │   ├── upload.js          # Загрузка файлов, presigned S3
│   │   │   ├── sessions.js        # Управление сессиями
│   │   │   ├── support.js         # Репорты пользователей
│   │   │   ├── sticker-packs.js   # Стикеры и emoji паки
│   │   │   ├── gif.js             # Пользовательские GIF
│   │   │   ├── totp.js            # Настройка 2FA
│   │   │   ├── search.js          # FTS5 полнотекстовый поиск
│   │   │   ├── linkPreview.js     # Open Graph превью ссылок
│   │   │   ├── push.js            # Web Push подписки
│   │   │   ├── admin.js           # Панель администратора
│   │   │   └── notes.js           # Заметки в чатах
│   │   ├── services/
│   │   │   ├── authService.js     # Бизнес-логика авторизации
│   │   │   └── ...                # Другие сервисы
│   │   ├── socket/
│   │   │   └── socketServer.js    # Socket.IO сервер, события
│   │   └── utils/
│   │       ├── jwt.js             # sign/verify JWT
│   │       ├── logger.js          # Структурированный лог
│   │       ├── s3.js              # S3 клиент (Yandex Cloud)
│   │       ├── corsOrigin.js      # CORS whitelist логика
│   │       ├── otp.js             # OTP генерация/проверка
│   │       ├── totp.js            # TOTP (Google Authenticator)
│   │       └── allowedMimeTypes.js # Allowlist MIME типов
├── web/
│   ├── src/
│   │   ├── api/                   # 15 API-клиентских модулей (axios)
│   │   ├── components/            # React компоненты UI
│   │   ├── hooks/                 # useSocket, useMessages, useSearch
│   │   ├── services/
│   │   │   └── webrtcManager.ts  # WebRTC singleton менеджер
│   │   ├── socket/
│   │   │   └── socketClient.ts   # Socket.IO клиент
│   │   ├── store/                 # 8 Zustand сторов
│   │   ├── storage/               # Session storage helpers
│   │   ├── utils/                 # Форматирование, темы, push
│   │   └── types.ts               # TypeScript типы всего проекта
│   ├── vite.config.ts
│   └── vercel.json
├── amvera.yaml                    # Amvera конфиг (Docker mode, root деплой)
├── backend/amvera.yaml            # Amvera конфиг (Node.js mode, backend деплой)
├── Dockerfile                     # Docker образ для Amvera
├── DEPLOY.md
└── .github/workflows/             # CI/CD
```

### 0.4 Конфигурация Amvera (деплой бэкенда)

Бэкенд задеплоен на **Amvera**. В репозитории два конфига:

**`amvera.yaml`** (корень репозитория — Docker-режим через корневой Dockerfile):
```yaml
meta:
  environment: docker
  toolchain:
    name: docker

build:
  dockerfile: Dockerfile

run:
  persistenceMount: /data   # SQLite файл хранится на персистентном томе
  containerPort: 3000
```

**`backend/amvera.yaml`** (Node.js-режим, деплой только backend директории):
```yaml
meta:
  environment: nodejs
  toolVersion: "20"

build:
  dockerfile: false
  buildDir: .
  buildCommand: rm -rf node_modules && npm install --production

run:
  persistenceMount: /data
  runCommand: node src/index.js
  containerPort: 3000
```

> **Важно:** Amvera не поддерживает поле `healthcheckPath` в `amvera.yaml` (в отличие от Railway). Эндпоинт `/health` используется для **внешнего мониторинга** через UptimeRobot / BetterUptime / StatusPage.

### 0.5 Переменные окружения (полный список)

```bash
# === ОБЯЗАТЕЛЬНЫЕ ===
JWT_SECRET=<64+ символов случайных>
MESSAGE_ENCRYPTION_KEY=<64 hex символа = 32 байта>

# === EMAIL (обязательно для prod) ===
SMTP_HOST=smtp.yandex.ru
SMTP_USER=no-reply@blizkie.ru
SMTP_PASS=<пароль>
SMTP_PORT=587
SMTP_FROM=Blizkie <no-reply@blizkie.ru>

# === ADMIN ===
ADMIN_PASSWORD_HASH=<bcrypt hash пароля>

# === ДЕПЛОЙ ===
NODE_ENV=production
APP_URL=https://api.blizkie.ru          # URL бэкенда на Amvera
ALLOWED_ORIGIN=https://blizkie.ru,https://www.blizkie.ru
DB_PATH=/data/blizkie.db               # персистентный том Amvera
PORT=3000

# === S3 (опционально) ===
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_BUCKET=blizkie-media
S3_REGION=ru-central1
S3_ENDPOINT=https://storage.yandexcloud.net
S3_PUBLIC_URL=https://blizkie-media.storage.yandexcloud.net

# === WEBRTC TURN (опционально) ===
TURN_URLS=turn:turn.blizkie.ru:3478,turns:turn.blizkie.ru:5349
TURN_USERNAME=
TURN_CREDENTIAL=

# === НОВЫЕ (будут добавлены в этом ТЗ) ===
REFRESH_TOKEN_SECRET=<64+ символов, отдельный от JWT_SECRET>
VAPID_PUBLIC_KEY=                          # уже есть
VAPID_PRIVATE_KEY=                         # уже есть
```

### 0.6 Ключевые договорённости и принципы работы

- Всё на **русском языке** в комментариях и коммитах не требуется — код на английском
- Коммиты по конвенции: `fix(auth): ...`, `feat(calls): ...`, `chore(db): ...`
- Каждое исправление — **отдельный PR** или минимум отдельный коммит
- Перед началом задачи — убедиться что тесты проходят: `cd backend && npm test`
- Фронтенд собирается: `cd web && npm run build`
- Никаких `--no-verify` при коммите

---

## ЧАСТЬ 1. РЕКОМЕНДУЕМАЯ ПОСЛЕДОВАТЕЛЬНОСТЬ РАБОТ

Задачи разбиты на фазы. **Каждая фаза должна быть полностью завершена перед переходом к следующей.**

```
ФАЗА A: Критические исправления (блокируют prod)
  A1. Health check эндпоинт
  A2. Graceful shutdown
  A3. Фоновый воркер для scheduled messages ✅ уже реализован
  A4. Rate limiting на Socket.IO события
  A5. Retry + logging для S3 операций

ФАЗА B: Безопасность
  B1. Access + Refresh token система (заменить 30-дневный JWT)
  B2. Rate limiting на регистрацию (IP)
  B3. Admin user table (заменить hardcoded hash)
  B4. Socket.IO — защита от спам-звонков
  B5. Link preview — защита от SSRF

ФАЗА C: Инфраструктура данных
  C1. Система версионирования миграций (schema_version)
  C2. Автобэкап SQLite на S3
  C3. Логирование S3 операций ✅ выполнено

ФАЗА D: Функциональные доработки
  D1. Голосовые сообщения (запись + waveform)
  D2. Самоуничтожающиеся сообщения (ephemeral)
  D3. Папки и фильтры чатов
  D4. Групповые звонки (до 8 участников)
  D5. PWA: Service Worker + offline режим
  D6. AI-функции (краткое содержание, умные ответы)
  D7. Экспорт истории (GDPR)
  D8. Stories / Статусы с медиа
  D9. WebAuthn / Passkeys

ФАЗА E: Качество кода
  E1. Расширить тест-покрытие (интеграционные тесты)
  E2. OpenAPI / Swagger документация
  E3. Мониторинг (OpenTelemetry / Sentry)
```

---

## ЧАСТЬ 2. ФАЗА A — КРИТИЧЕСКИЕ ИСПРАВЛЕНИЯ

---

### A1. Health Check эндпоинт

**Статус:** ✅ ВЫПОЛНЕНО (коммит `30689cff`, ветка `devDK`)

**Файл создан:** `backend/src/routes/health.js`  
**Изменён:** `backend/src/index.js`  
**Приоритет:** P0  
**Зачем:** Amvera не перезапускает контейнер автоматически при зависании процесса без внешнего сигнала. Эндпоинт `/health` подключается к UptimeRobot / BetterUptime — при получении статуса `503` сервис оповещает администратора и может инициировать рестарт через Amvera Webhook API.

> **Отличие от Railway:** Railway имеет встроенный `healthcheckPath` в `railway.json`. Amvera такого поля не поддерживает. Health check настраивается **внешним** инструментом мониторинга, который пингует `GET /health` каждые 60 секунд.

#### Реализованный код: `backend/src/routes/health.js`

Проект использует **CommonJS** (`require`/`module.exports`), не ES-модули.

```javascript
const { Router } = require('express');
const { getDb } = require('../config/database');

const router = Router();

router.get('/', (req, res) => {
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();          // проверяем живость SQLite
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      db: 'ok',
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      db: 'unavailable',
    });
  }
});

module.exports = router;
```

#### Изменения в `backend/src/index.js`

```javascript
// Подключение роута (добавлено в imports):
const healthRoutes = require('./routes/health');

// Регистрация ПЕРВЫМ, до всех остальных роутов (нет auth):
app.use('/health', healthRoutes);
```

Старая однострочная заглушка `app.get('/health', (req, res) => res.json({ status: 'ok' }))` удалена.

#### Настройка внешнего мониторинга (UptimeRobot)

После деплоя на Amvera подключить бесплатный мониторинг:

1. Зарегистрироваться на [uptimerobot.com](https://uptimerobot.com)
2. Создать монитор: `HTTP(s)` → URL: `https://<amvera-domain>/health`
3. Интервал: `60 секунд`
4. Алерт: email/Telegram при статусе не `200`
5. Keyword мониторинг: проверять что ответ содержит `"status":"ok"`

Ответ при нормальной работе:
```json
{ "status": "ok", "timestamp": "2026-04-30T12:00:00.000Z", "uptime": 3600, "db": "ok" }
```

Ответ при проблемах с БД (HTTP 503):
```json
{ "status": "error", "timestamp": "2026-04-30T12:00:00.000Z", "uptime": 3600, "db": "unavailable" }
```

---

### A2. Graceful Shutdown

**Файл:** `backend/src/index.js`  
**Приоритет:** P0  
**Зачем:** При редеплое Amvera останавливает контейнер через SIGTERM. Без graceful shutdown активные WebSocket соединения обрываются резко, незавершённые запросы теряются, SQLite может получить битый WAL (уже были прецеденты — см. код восстановления в `config/database.js`).

#### Что сделать

В конце `backend/src/index.js`, после `server.listen(...)`, добавить:

```javascript
let isShuttingDown = false;

function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[shutdown] Received ${signal}, starting graceful shutdown...`);

  // Перестать принимать новые соединения
  server.close(() => {
    console.log('[shutdown] HTTP server closed');
  });

  // Закрыть Socket.IO (уведомить клиентов)
  io.close(() => {
    console.log('[shutdown] Socket.IO closed');
  });

  // Дать 10 секунд на завершение запросов, потом убить процесс
  setTimeout(() => {
    console.error('[shutdown] Forced exit after timeout');
    process.exit(1);
  }, 10_000).unref();

  // Закрыть БД корректно
  try {
    const db = getDb();
    db.close();
    console.log('[shutdown] Database closed');
  } catch (e) {
    console.error('[shutdown] Error closing database:', e.message);
  }

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
```

---

### A3. Фоновый воркер для Scheduled Messages

**Статус:** ✅ УЖЕ РЕАЛИЗОВАНО — дополнительных действий не требуется

**Где смотреть:**
- `backend/src/services/messageService.js:243` — функция `deliverPendingMessages()`
- `backend/src/socket/socketServer.js:385` — `setInterval` на 30 секунд

#### Что реально реализовано

Механизм доставки встроен прямо в Socket.IO init-блок (`socketServer.js`) через `setInterval`. Запускается каждые **30 секунд** при старте сервера.

**`messageService.js` — `deliverPendingMessages()`:**
```javascript
function deliverPendingMessages() {
  const db = getDb();
  const now = Date.now();
  const due = db.prepare(
    `SELECT * FROM messages
     WHERE is_delivered = 0 AND deliver_at <= ? AND deleted_at IS NULL`
  ).all(now);

  if (due.length === 0) return [];

  for (const row of due) {
    db.prepare('UPDATE messages SET is_delivered = 1, created_at = ? WHERE id = ?').run(now, row.id);
    db.prepare(`UPDATE chat_members SET unread_count = unread_count + 1
                WHERE chat_id = ? AND user_id != ?`).run(row.chat_id, row.sender_id);
    delivered.push(decryptMessage({ ...row, is_delivered: 1, created_at: now }));
  }
  return delivered;
}
```

**`socketServer.js` — цикл доставки:**
```javascript
// Каждые 30 секунд при запуске Socket.IO
setInterval(async () => {
  const delivered = deliverPendingMessages();
  if (delivered.length === 0) return;
  for (const msg of delivered) {
    // Подписать S3 URL если есть вложение
    if (msg.attachment_url) msg.attachment_url = await signUrl(msg.attachment_url);
    // Разослать участникам чата
    const members = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(msg.chat_id);
    for (const m of members) io.to(`user:${m.user_id}`).emit('new-message', msg);
    // Push оффлайн участникам
    fireAndForgetPush(msg.chat_id, msg.sender_id, { text: msg.text, ... }, io);
  }
}, 30 * 1000);
```

**Индекс в БД** (`migrations.js`):
```sql
CREATE INDEX IF NOT EXISTS idx_messages_scheduled
  ON messages(deliver_at, is_delivered)
  WHERE deliver_at IS NOT NULL
```

Реализация полная: есть доставка, обновление `unread_count`, подпись S3 URL, Web Push для оффлайн-пользователей. `node-cron` и отдельный workers-файл не нужны.

---

### A4. Rate Limiting на Socket.IO события

**Файл:** `backend/src/socket/socketServer.js`  
**Приоритет:** P0  
**Зачем:** HTTP-эндпоинты защищены `express-rate-limit`, но Socket.IO события не ограничены. Авторизованный пользователь может спамить звонками, typing-событиями и перегрузить сервер.

#### Что сделать

В начало `backend/src/socket/socketServer.js` добавить helper:

```javascript
// Простой токен-бакет per-socket
function createThrottle(maxTokens, refillRatePerSecond) {
  const buckets = new Map(); // socketId → { tokens, lastRefill }

  return function allow(socketId) {
    const now = Date.now();
    if (!buckets.has(socketId)) {
      buckets.set(socketId, { tokens: maxTokens, lastRefill: now });
    }
    const bucket = buckets.get(socketId);
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(maxTokens, bucket.tokens + elapsed * refillRatePerSecond);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  };
}

// Очистка бакетов при дисконнекте (вызвать в on('disconnect'))
function cleanupThrottle(socketId, ...throttles) {
  // каждый throttle хранит Map внутри — не публичная, поэтому обёртка:
}

const allowMessage  = createThrottle(20, 2);   // burst 20, 2 msg/sec
const allowTyping   = createThrottle(5,  1);   // burst 5, 1/sec
const allowCallInvite = createThrottle(3, 0.1); // 3 burst, 1 звонок каждые 10 сек
const allowReaction = createThrottle(10, 1);   // 10 burst, 1/sec
```

В обработчиках событий добавить проверку:

```javascript
socket.on('send-message', (data) => {
  if (!allowMessage(socket.id)) {
    return socket.emit('error', { code: 'RATE_LIMITED', message: 'Too many messages' });
  }
  // ... остальная логика
});

socket.on('typing-start', (data) => {
  if (!allowTyping(socket.id)) return; // тихо игнорировать
  // ... остальная логика
});

socket.on('call:invite', (data) => {
  if (!allowCallInvite(socket.id)) {
    return socket.emit('call:error', { code: 'RATE_LIMITED', message: 'Too many call attempts' });
  }
  // ... остальная логика
});

socket.on('message-reaction', (data) => {
  if (!allowReaction(socket.id)) return;
  // ... остальная логика
});

// При дисконнекте — очистка не нужна, Map заполняется по мере использования
// но можно добавить периодическую очистку старых записей:
socket.on('disconnect', () => {
  // Map очищается garbage collector, либо добавить явную очистку
  const maps = [allowMessage, allowTyping, allowCallInvite, allowReaction];
  // Если реализовать с публичным .clear(id) — вызвать здесь
});
```

---

### A5. Retry и Logging для S3 операций

**Файл:** `backend/src/utils/s3.js`  
**Приоритет:** P1  
**Зачем:** Текущий код делает `deleteObject().promise().catch(() => {})` — ошибка молча игнорируется. Удалённые сообщения оставляют «висячие» файлы в S3, которые накапливаются и тратят деньги.

#### Что сделать

В `backend/src/utils/s3.js` заменить все `catch(() => {})` на retry-обёртку:

```javascript
import logger from './logger.js';

// Retry с экспоненциальным backoff
async function withRetry(fn, { attempts = 3, label = 'S3 operation' } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = i === attempts - 1;
      logger.warn(`${label} failed (attempt ${i + 1}/${attempts})`, {
        error: err.message,
        code: err.code,
      });
      if (isLast) {
        logger.error(`${label} permanently failed after ${attempts} attempts`, {
          error: err.message,
        });
        // НЕ бросаем ошибку выше — S3 фейл не должен ломать бизнес-логику
        return null;
      }
      await new Promise(r => setTimeout(r, 200 * 2 ** i)); // 200ms, 400ms, 800ms
    }
  }
}

// Пример использования при удалении:
export async function deleteS3Object(key) {
  return withRetry(
    () => s3.deleteObject({ Bucket: S3_BUCKET, Key: key }).promise(),
    { label: `S3 delete ${key}` }
  );
}
```

Добавить в `backend/src/db/migrations.js` таблицу очереди на удаление для надёжной гарантии:

```sql
CREATE TABLE IF NOT EXISTS s3_delete_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  s3_key      TEXT NOT NULL,
  attempts    INTEGER DEFAULT 0,
  last_error  TEXT,
  created_at  INTEGER DEFAULT (unixepoch('now') * 1000),
  deleted_at  INTEGER
);
```

Воркер в `backend/src/workers/s3Cleanup.js`:

```javascript
import cron from 'node-cron';
import { getDb } from '../config/database.js';
import { deleteS3Object } from '../utils/s3.js';
import logger from '../utils/logger.js';

export function startS3CleanupWorker() {
  // Каждые 5 минут
  cron.schedule('*/5 * * * *', processDeleteQueue);
  logger.info('S3 cleanup worker started');
}

async function processDeleteQueue() {
  const db = getDb();
  const items = db.prepare(`
    SELECT * FROM s3_delete_queue
    WHERE deleted_at IS NULL AND attempts < 5
    LIMIT 50
  `).all();

  for (const item of items) {
    const result = await deleteS3Object(item.s3_key);
    if (result !== null) {
      db.prepare(`UPDATE s3_delete_queue SET deleted_at = ? WHERE id = ?`)
        .run(Date.now(), item.id);
    } else {
      db.prepare(`UPDATE s3_delete_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?`)
        .run('failed', item.id);
    }
  }
}
```

При удалении файла в роутах — вместо прямого delete, добавлять в очередь:

```javascript
// Было:
await s3.deleteObject(...).promise().catch(() => {});

// Стало:
db.prepare(`INSERT INTO s3_delete_queue (s3_key) VALUES (?)`).run(s3Key);
```

---

## ЧАСТЬ 3. ФАЗА B — БЕЗОПАСНОСТЬ

---

### B1. Access + Refresh Token система

**Файлы:**
- `backend/src/utils/jwt.js` — изменить
- `backend/src/routes/auth.js` — изменить
- `backend/src/middleware/auth.js` — изменить
- `backend/src/db/migrations.js` — добавить таблицу
- `web/src/api/client.ts` — добавить interceptor для refresh

**Приоритет:** P0  
**Зачем:** Текущий JWT живёт 30 дней. При компрометации токена у пользователя нет защиты. Refresh-механизм даёт Access Token на 15 минут (короткое окно атаки) и Refresh Token на 30 дней (для удобства пользователя).

#### Шаг 1: Добавить таблицу refresh_tokens в migrations.js

```javascript
db.exec(`
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          TEXT PRIMARY KEY,       -- UUID, он же jti
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL,          -- bcrypt hash refresh token
    expires_at  INTEGER NOT NULL,       -- timestamp ms
    revoked     INTEGER DEFAULT 0,
    created_at  INTEGER DEFAULT (unixepoch('now') * 1000),
    ip          TEXT,
    user_agent  TEXT,
    UNIQUE(id)
  );
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id, revoked);
`);
```

#### Шаг 2: Изменить `backend/src/utils/jwt.js`

```javascript
import { sign, verify } from 'jsonwebtoken';
import { randomUUID } from 'crypto';

const ACCESS_SECRET  = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.REFRESH_TOKEN_SECRET || ACCESS_SECRET + '_refresh';

export function signAccessToken(userId, sessionId) {
  return sign(
    { sub: String(userId), jti: sessionId, type: 'access' },
    ACCESS_SECRET,
    { expiresIn: '15m' }
  );
}

export function signRefreshToken(userId, sessionId) {
  const jti = randomUUID();
  const token = sign(
    { sub: String(userId), jti, sid: sessionId, type: 'refresh' },
    REFRESH_SECRET,
    { expiresIn: '30d' }
  );
  return { token, jti };
}

export function verifyAccessToken(token) {
  return verify(token, ACCESS_SECRET);
}

export function verifyRefreshToken(token) {
  return verify(token, REFRESH_SECRET);
}
```

#### Шаг 3: Изменить `backend/src/routes/auth.js` — login endpoint

```javascript
// POST /auth/login — ответ теперь отдаёт ОБА токена
import { signAccessToken, signRefreshToken } from '../utils/jwt.js';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

// После успешной проверки пароля:
const sessionId = randomUUID();
db.prepare(`
  INSERT INTO sessions (id, user_id, ip, user_agent, created_at, last_used_at)
  VALUES (?, ?, ?, ?, ?, ?)
`).run(sessionId, user.id, req.ip, req.headers['user-agent'] || '', Date.now(), Date.now());

const accessToken  = signAccessToken(user.id, sessionId);
const { token: refreshToken, jti: refreshJti } = signRefreshToken(user.id, sessionId);

// Сохранить хэш refresh token в БД
const refreshHash = await bcrypt.hash(refreshToken, 8); // cost 8 — быстрее для refresh
db.prepare(`
  INSERT INTO refresh_tokens (id, user_id, session_id, token_hash, expires_at, ip, user_agent)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
  refreshJti,
  user.id,
  sessionId,
  refreshHash,
  Date.now() + 30 * 24 * 60 * 60 * 1000,
  req.ip,
  req.headers['user-agent'] || ''
);

// Установить refresh token в httpOnly cookie
res.cookie('refresh_token', refreshToken, {
  httpOnly: true,
  secure: NODE_ENV === 'production',
  sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: '/auth/refresh',   // только для эндпоинта refresh
});

// Access token — в тело ответа (или короткоживущий cookie)
res.json({
  token: accessToken,
  user: { id: user.id, username: user.username, /* ... */ },
});
```

#### Шаг 4: Создать эндпоинт `POST /auth/refresh`

```javascript
// POST /auth/refresh
// Принимает refresh_token из cookie, возвращает новый access_token
app.post('/auth/refresh', refreshLimiter, async (req, res) => {
  const refreshToken = req.cookies?.refresh_token;
  if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }

  if (payload.type !== 'refresh') return res.status(401).json({ error: 'Invalid token type' });

  const stored = db.prepare(`
    SELECT * FROM refresh_tokens WHERE id = ? AND revoked = 0
  `).get(payload.jti);

  if (!stored || stored.expires_at < Date.now()) {
    return res.status(401).json({ error: 'Refresh token expired or revoked' });
  }

  // Проверить hash
  const valid = await bcrypt.compare(refreshToken, stored.token_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid refresh token' });

  // Rotation: отозвать старый, выпустить новый
  db.prepare(`UPDATE refresh_tokens SET revoked = 1 WHERE id = ?`).run(payload.jti);

  const newAccessToken = signAccessToken(stored.user_id, stored.session_id);
  const { token: newRefreshToken, jti: newJti } = signRefreshToken(stored.user_id, stored.session_id);
  const newHash = await bcrypt.hash(newRefreshToken, 8);

  db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, session_id, token_hash, expires_at, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    newJti, stored.user_id, stored.session_id, newHash,
    Date.now() + 30 * 24 * 60 * 60 * 1000, req.ip, req.headers['user-agent'] || ''
  );

  res.cookie('refresh_token', newRefreshToken, {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/auth/refresh',
  });

  res.json({ token: newAccessToken });
});
```

#### Шаг 5: Изменить `backend/src/middleware/auth.js`

```javascript
import { verifyAccessToken } from '../utils/jwt.js';

export function authMiddleware(req, res, next) {
  // Принимать только access tokens (type: 'access')
  const token = req.cookies?.session || req.headers.authorization?.slice(7);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Проверить что session не отозвана
  const session = db.prepare('SELECT id, revoked FROM sessions WHERE id = ?').get(payload.jti);
  if (!session || session.revoked) {
    return res.status(401).json({ error: 'Session revoked' });
  }

  req.userId = Number(payload.sub);
  req.sessionId = payload.jti;
  next();
}
```

#### Шаг 6: Изменить `web/src/api/client.ts` — auto-refresh

```typescript
// Добавить response interceptor
client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    if (
      error.response?.status === 401 &&
      error.response?.data?.code === 'TOKEN_EXPIRED' &&
      !originalRequest._retry
    ) {
      originalRequest._retry = true;
      try {
        // Запросить новый access token
        const { data } = await client.post('/auth/refresh');
        const newToken = data.token;
        
        // Сохранить новый токен
        useSessionStore.getState().setToken(newToken);
        
        // Повторить оригинальный запрос с новым токеном
        originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
        return client(originalRequest);
      } catch (refreshError) {
        // Refresh тоже провалился — разлогинить
        useSessionStore.getState().logout();
        return Promise.reject(refreshError);
      }
    }
    
    return Promise.reject(error);
  }
);
```

---

### B2. Rate Limiting на регистрацию по IP

**Файл:** `backend/src/middleware/rateLimits.js`  
**Приоритет:** P1  
**Зачем:** Лимит есть только на отправку OTP (5/час). Но создавать аккаунты через разные временные email — не ограничено. Нужен IP-уровень лимит.

#### Что добавить в `rateLimits.js`

```javascript
export const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 час
  max: 5,                    // 5 регистраций с одного IP
  message: { error: 'Too many registration attempts, try again in an hour' },
  standardHeaders: true,
  legacyHeaders: false,
});
```

В `backend/src/routes/auth.js` применить к эндпоинту создания аккаунта:

```javascript
import { registrationLimiter } from '../middleware/rateLimits.js';

router.post('/verify-email-and-create-account', registrationLimiter, async (req, res) => {
  // ... существующая логика
});
```

---

### B3. Admin User Table (заменить hardcoded hash)

**Файлы:**
- `backend/src/db/migrations.js` — добавить таблицу
- `backend/src/routes/admin.js` — изменить аутентификацию

**Приоритет:** P1  
**Зачем:** `ADMIN_PASSWORD_HASH` в env — примитивно. Нет ролей, нет 2FA для админа, нет возможности иметь нескольких администраторов.

#### Шаг 1: Таблица в migrations.js

```javascript
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    totp_secret   TEXT,                -- 2FA для admin (обязательно включить в prod)
    role          TEXT DEFAULT 'admin' CHECK(role IN ('admin', 'superadmin')),
    created_at    INTEGER DEFAULT (unixepoch('now') * 1000),
    last_login_at INTEGER,
    is_active     INTEGER DEFAULT 1
  );
`);
```

#### Шаг 2: CLI-скрипт для создания первого admin

Создать `backend/scripts/createAdmin.js`:

```javascript
#!/usr/bin/env node
// Использование: node scripts/createAdmin.js <username> <password>
import bcrypt from 'bcryptjs';
import { getDb } from '../src/config/database.js';

const [,, username, password] = process.argv;
if (!username || !password) {
  console.error('Usage: node scripts/createAdmin.js <username> <password>');
  process.exit(1);
}

const db = getDb();
const hash = await bcrypt.hash(password, 12);
db.prepare(`
  INSERT INTO admins (username, password_hash) VALUES (?, ?)
`).run(username, hash);
console.log(`Admin '${username}' created successfully`);
process.exit(0);
```

#### Шаг 3: Изменить аутентификацию в `admin.js`

```javascript
// POST /admin/login
router.post('/login', adminLoginLimiter, async (req, res) => {
  const { username, password } = req.body;
  
  const admin = db.prepare('SELECT * FROM admins WHERE username = ? AND is_active = 1').get(username);
  
  const DUMMY = '$2b$12$dummy.hash.for.timing.normalization.only';
  const hash = admin?.password_hash || DUMMY;
  const valid = await bcrypt.compare(password || '', hash);
  
  if (!admin || !valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  // Обновить last_login_at
  db.prepare('UPDATE admins SET last_login_at = ? WHERE id = ?').run(Date.now(), admin.id);
  
  // Выпустить admin JWT (отдельный secret или claim)
  const token = signAdminToken(admin.id, admin.username, admin.role);
  
  res.cookie('admin_session', token, {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 4 * 60 * 60 * 1000, // 4 часа для admin
  });
  
  res.json({ ok: true });
});
```

---

### B4. Защита от спам-звонков (call:invite)

**Файл:** `backend/src/socket/socketServer.js`  
**Приоритет:** P1  
**Зачем:** Один пользователь может слать `call:invite` сотни раз в секунду, перегружая UI жертвы всплывающими звонками.

#### Что добавить

В секции обработки `call:invite` в `socketServer.js`:

```javascript
// Map: callerId → { count, firstAt }
const callInviteTracker = new Map();

socket.on('call:invite', (data) => {
  const now = Date.now();
  const key = socket.userId;
  const tracker = callInviteTracker.get(key) || { count: 0, firstAt: now };
  
  // Сбросить счётчик если прошло больше минуты
  if (now - tracker.firstAt > 60_000) {
    tracker.count = 0;
    tracker.firstAt = now;
  }
  
  tracker.count++;
  callInviteTracker.set(key, tracker);
  
  if (tracker.count > 5) { // Максимум 5 звонков в минуту
    return socket.emit('call:error', {
      code: 'TOO_MANY_CALLS',
      message: 'You are making calls too frequently',
    });
  }
  
  // ... остальная логика звонка
});
```

---

### B5. Защита link preview от SSRF

**Файл:** `backend/src/routes/linkPreview.js`  
**Приоритет:** P1  
**Зачем:** Без проверки пользователь может попросить сервер сделать запрос к `http://169.254.169.254` (AWS metadata), к `http://localhost:6379` (Redis), к внутренней сети.

#### Что добавить

```javascript
import { URL } from 'url';
import dns from 'dns/promises';
import ipaddr from 'ipaddr.js'; // npm install ipaddr.js

async function isSafeUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  
  // Только HTTP/HTTPS
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  
  // Не localhost
  const hostname = parsed.hostname;
  if (['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return false;
  
  // Резолвим и проверяем что не приватный IP
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    for (const { address } of addresses) {
      const parsed = ipaddr.parse(address);
      if (parsed.range() !== 'unicast') return false; // loopback, private, etc.
    }
  } catch {
    return false; // DNS не резолвится — не открываем
  }
  
  return true;
}

// В обработчике GET /link-preview:
router.get('/', previewLimiter, async (req, res) => {
  const { url } = req.query;
  if (!url || !(await isSafeUrl(url))) {
    return res.status(400).json({ error: 'Invalid or unsafe URL' });
  }
  // ... fetch с timeout
});
```

---

## ЧАСТЬ 4. ФАЗА C — ИНФРАСТРУКТУРА ДАННЫХ

---

### C1. Версионирование миграций

**Файлы:**
- `backend/src/db/migrations.js` — рефакторинг
- `backend/src/db/versions/` — новая директория

**Приоритет:** P1  
**Зачем:** Текущая система — один большой блок `CREATE TABLE IF NOT EXISTS`. При изменении схемы (добавление столбца, индекса) нужно писать `ALTER TABLE` вручную и нет гарантии что они выполнились.

#### Архитектура

```
backend/src/db/
├── migrate.js          # Движок: читает versions/, применяет новые
└── versions/
    ├── 001_initial.js  # Вся текущая схема
    ├── 002_refresh_tokens.js
    ├── 003_s3_delete_queue.js
    ├── 004_admins.js
    └── ...
```

#### `backend/src/db/migrate.js`

```javascript
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dir = dirname(fileURLToPath(import.meta.url));

export function runMigrations(db) {
  // Создать таблицу версий если не существует
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  INTEGER DEFAULT (unixepoch('now') * 1000)
    );
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version)
  );

  const versionsDir = join(__dir, 'versions');
  const files = readdirSync(versionsDir)
    .filter(f => f.endsWith('.js'))
    .sort(); // 001_, 002_, ... — сортировка по имени файла

  for (const file of files) {
    const version = parseInt(file.split('_')[0], 10);
    if (applied.has(version)) continue;

    logger.info(`Applying migration ${file}...`);
    const migration = await import(join(versionsDir, file));
    
    const applyMigration = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(version, file);
    });
    
    applyMigration();
    logger.info(`Migration ${file} applied`);
  }
}
```

#### Первая версия `backend/src/db/versions/001_initial.js`

```javascript
// Вся текущая схема переносится сюда из migrations.js
export function up(db) {
  db.exec(`
    -- Всё содержимое текущего migrations.js
    CREATE TABLE IF NOT EXISTS users ( ... );
    CREATE TABLE IF NOT EXISTS sessions ( ... );
    -- и т.д.
  `);
}
```

Каждое последующее изменение схемы — новый файл `00N_description.js` с функцией `up(db)`.

---

### C2. Автобэкап SQLite на S3

**Новый файл:** `backend/src/workers/dbBackup.js`  
**Приоритет:** P1  
**Зачем:** SQLite — единственная БД. Если Railway volume повредится или удалится — все данные потеряны без бэкапа.

#### `backend/src/workers/dbBackup.js`

```javascript
import cron from 'node-cron';
import { createReadStream, statSync } from 'fs';
import { getDb } from '../config/database.js';
import { s3 } from '../utils/s3.js';
import logger from '../utils/logger.js';

const DB_PATH    = process.env.DB_PATH || '/data/blizkie.db';
const S3_BUCKET  = process.env.S3_BUCKET;
const BACKUP_DIR = process.env.S3_BACKUP_PREFIX || 'backups/';

export function startDbBackupWorker() {
  if (!S3_BUCKET) {
    logger.warn('S3_BUCKET not set — DB backup disabled');
    return;
  }
  
  // Каждый день в 3:00 UTC
  cron.schedule('0 3 * * *', runBackup);
  logger.info('DB backup worker started (daily at 03:00 UTC)');
}

async function runBackup() {
  const db = getDb();
  const backupPath = `${DB_PATH}.backup-${Date.now()}`;
  
  try {
    // SQLite Online Backup API (не блокирует reads/writes)
    await db.backup(backupPath);
    
    const date = new Date().toISOString().split('T')[0];
    const key = `${BACKUP_DIR}blizkie-${date}.db`;
    
    const fileStream = createReadStream(backupPath);
    const { size } = statSync(backupPath);
    
    await s3.putObject({
      Bucket: S3_BUCKET,
      Key: key,
      Body: fileStream,
      ContentLength: size,
      ContentType: 'application/octet-stream',
    }).promise();
    
    // Удалить локальный backup файл
    import('fs').then(({ unlinkSync }) => {
      try { unlinkSync(backupPath); } catch {}
    });
    
    logger.info(`DB backup completed: s3://${S3_BUCKET}/${key} (${size} bytes)`);
    
    // Удалить бэкапы старше 30 дней
    await pruneOldBackups();
    
  } catch (err) {
    logger.error('DB backup failed', { error: err.message });
  }
}

async function pruneOldBackups() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const { Contents } = await s3.listObjectsV2({
    Bucket: S3_BUCKET,
    Prefix: BACKUP_DIR,
  }).promise();
  
  const toDelete = (Contents || []).filter(obj =>
    new Date(obj.LastModified) < thirtyDaysAgo
  );
  
  if (toDelete.length === 0) return;
  
  await s3.deleteObjects({
    Bucket: S3_BUCKET,
    Delete: { Objects: toDelete.map(o => ({ Key: o.Key })) },
  }).promise();
  
  logger.info(`Pruned ${toDelete.length} old DB backups`);
}
```

---

## ЧАСТЬ 5. ФАЗА D — ФУНКЦИОНАЛЬНЫЕ ДОРАБОТКИ

---

### D1. Голосовые сообщения

**Приоритет:** P0 (самая запрашиваемая фича мессенджеров)  
**Суть:** Записать аудио через MediaRecorder API, отправить как вложение с waveform preview.

#### Схема данных

Сообщение с голосовым сообщением — это обычное сообщение с `type = 'voice'` и вложением. Добавить в таблицу `messages` (миграция `005_voice_messages.js`):

```javascript
export function up(db) {
  db.exec(`
    ALTER TABLE messages ADD COLUMN voice_duration INTEGER; -- длительность в секундах
    ALTER TABLE messages ADD COLUMN voice_waveform TEXT;    -- JSON array [0..100] пиков
  `);
}
```

#### Backend: новый тип в upload.js

```javascript
// Голосовое — только audio/webm или audio/ogg
const VOICE_MIME = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav'];

router.post('/voice', authMiddleware, upload.single('voice'), async (req, res) => {
  if (!VOICE_MIME.includes(req.file.mimetype)) {
    return res.status(415).json({ error: 'Unsupported audio format' });
  }
  
  // Максимум 5 минут (приблизительно 5MB для webm opus)
  if (req.file.size > 5 * 1024 * 1024) {
    return res.status(413).json({ error: 'Voice message too large (max 5MB / ~5 min)' });
  }
  
  const key = `voices/${req.userId}/${Date.now()}.webm`;
  // upload to S3 или local
  const url = await uploadFile(req.file.buffer, key, req.file.mimetype);
  
  res.json({ url, duration: Number(req.body.duration) || 0 });
});
```

#### Frontend: компонент VoiceRecorder

Создать `web/src/components/VoiceRecorder.tsx`:

```typescript
import { useState, useRef, useCallback } from 'react';

interface VoiceRecorderProps {
  onSend: (blob: Blob, duration: number, waveform: number[]) => void;
  onCancel: () => void;
}

export function VoiceRecorder({ onSend, onCancel }: VoiceRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const waveformRef = useRef<number[]>([]);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Подключить analyser для waveform
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;
    
    // Семплировать waveform каждые 100ms
    const data = new Uint8Array(analyser.frequencyBinCount);
    const sampleWaveform = () => {
      analyser.getByteFrequencyData(data);
      const peak = Math.max(...data);
      waveformRef.current.push(Math.round((peak / 255) * 100));
    };
    timerRef.current = window.setInterval(() => {
      setDuration(d => d + 1);
      sampleWaveform();
    }, 1000);
    
    const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    chunksRef.current = [];
    mr.ondataavailable = e => chunksRef.current.push(e.data);
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      stream.getTracks().forEach(t => t.stop());
      ctx.close();
      onSend(blob, duration, waveformRef.current);
    };
    mr.start();
    mediaRecorderRef.current = mr;
    setRecording(true);
  }, [duration, onSend]);

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }, []);

  return (
    <div className="voice-recorder">
      {!recording ? (
        <button onClick={start} title="Записать голосовое">🎤</button>
      ) : (
        <>
          <span className="voice-duration">{duration}s</span>
          <button onClick={onCancel}>✕</button>
          <button onClick={stop}>⏹ Отправить</button>
        </>
      )}
    </div>
  );
}
```

#### Frontend: компонент воспроизведения VoiceMessage

```typescript
// web/src/components/VoiceMessage.tsx
interface VoiceMessageProps {
  url: string;
  duration: number;
  waveform: number[];
}

export function VoiceMessage({ url, duration, waveform }: VoiceMessageProps) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); } else { audio.play(); }
    setPlaying(!playing);
  };

  return (
    <div className="voice-message">
      <button onClick={toggle}>{playing ? '⏸' : '▶'}</button>
      <div className="waveform">
        {waveform.map((h, i) => (
          <div
            key={i}
            className="waveform-bar"
            style={{
              height: `${h}%`,
              backgroundColor: i / waveform.length < progress ? 'var(--accent)' : 'var(--muted)',
            }}
          />
        ))}
      </div>
      <span>{Math.floor(duration / 60)}:{String(duration % 60).padStart(2, '0')}</span>
      <audio
        ref={audioRef}
        src={url}
        onTimeUpdate={e => setProgress(e.currentTarget.currentTime / e.currentTarget.duration)}
        onEnded={() => setPlaying(false)}
      />
    </div>
  );
}
```

---

### D2. Самоуничтожающиеся сообщения (Ephemeral)

**Приоритет:** P1  
**Суть:** Сообщения с `expires_at` автоматически удаляются на сервере и скрываются у клиента.

#### Миграция `006_ephemeral_messages.js`

```javascript
export function up(db) {
  db.exec(`
    ALTER TABLE messages ADD COLUMN expires_at INTEGER; -- timestamp ms, NULL = не истекает
    ALTER TABLE chats ADD COLUMN default_ttl INTEGER;   -- TTL по умолчанию для чата (секунды)
    CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at)
      WHERE expires_at IS NOT NULL AND deleted_at IS NULL;
  `);
}
```

#### Воркер удаления `backend/src/workers/ephemeralMessages.js`

```javascript
import cron from 'node-cron';
import { getDb } from '../config/database.js';
import logger from '../utils/logger.js';

export function startEphemeralWorker(io) {
  // Каждую минуту
  cron.schedule('* * * * *', () => deleteExpired(io));
  logger.info('Ephemeral messages worker started');
}

function deleteExpired(io) {
  const db = getDb();
  const now = Date.now();
  
  const expired = db.prepare(`
    SELECT id, chat_id FROM messages
    WHERE expires_at IS NOT NULL AND expires_at <= ? AND deleted_at IS NULL
    LIMIT 200
  `).all(now);
  
  if (expired.length === 0) return;
  
  const ids = expired.map(r => r.id);
  const chatIds = [...new Set(expired.map(r => r.chat_id))];
  
  db.prepare(`
    UPDATE messages SET deleted_at = ?, deleted_by = NULL
    WHERE id IN (${ids.map(() => '?').join(',')})
  `).run(now, ...ids);
  
  // Уведомить клиентов
  for (const { id, chat_id } of expired) {
    io.to(`chat:${chat_id}`).emit('message-deleted', { messageId: id, chatId: chat_id });
  }
  
  logger.info(`Deleted ${expired.length} expired ephemeral messages`);
}
```

#### API: установить TTL при отправке

```javascript
// В POST /messages — принимать поле expires_in (секунды)
const { text, expires_in } = req.body;
const expires_at = expires_in ? Date.now() + expires_in * 1000 : null;

// При создании сообщения:
db.prepare(`
  INSERT INTO messages (..., expires_at) VALUES (..., ?)
`).run(..., expires_at);
```

#### API: установить default_ttl для чата

```javascript
// PATCH /chats/:chatId — добавить поле default_ttl
router.patch('/:chatId', authMiddleware, async (req, res) => {
  const { default_ttl } = req.body; // null = выключить, 86400 = 1 день, 604800 = 7 дней
  // Только admin/moderator может изменить
  db.prepare('UPDATE chats SET default_ttl = ? WHERE id = ?').run(default_ttl, chatId);
  io.to(`chat:${chatId}`).emit('chat-updated', { chatId, default_ttl });
  res.json({ ok: true });
});
```

---

### D3. Папки и фильтры чатов

**Приоритет:** P1  
**Суть:** Пользователь создаёт папки ("Работа", "Семья"), добавляет чаты в папки, фильтрует список.

#### Миграция `007_chat_folders.js`

```javascript
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_folders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      emoji      TEXT,              -- иконка папки
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch('now') * 1000),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS chat_folder_members (
      folder_id  INTEGER NOT NULL REFERENCES chat_folders(id) ON DELETE CASCADE,
      chat_id    INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      PRIMARY KEY (folder_id, chat_id)
    );

    CREATE INDEX IF NOT EXISTS idx_folder_members_user
      ON chat_folder_members(folder_id);
  `);
}
```

#### Routes `backend/src/routes/folders.js`

```javascript
import { Router } from 'express';
import { getDb } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /folders — получить все папки пользователя с количеством чатов
router.get('/', (req, res) => {
  const db = getDb();
  const folders = db.prepare(`
    SELECT f.*, COUNT(cfm.chat_id) as chat_count
    FROM chat_folders f
    LEFT JOIN chat_folder_members cfm ON cfm.folder_id = f.id
    WHERE f.user_id = ?
    GROUP BY f.id
    ORDER BY f.sort_order, f.created_at
  `).all(req.userId);
  res.json(folders);
});

// POST /folders — создать папку
router.post('/', (req, res) => {
  const { name, emoji } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO chat_folders (user_id, name, emoji) VALUES (?, ?, ?)
  `).run(req.userId, name.trim(), emoji || null);
  res.status(201).json({ id: result.lastInsertRowid, name, emoji });
});

// PUT /folders/:id — переименовать / изменить emoji
router.put('/:id', (req, res) => {
  const { name, emoji, sort_order } = req.body;
  const db = getDb();
  db.prepare(`
    UPDATE chat_folders SET name = COALESCE(?, name), emoji = COALESCE(?, emoji), sort_order = COALESCE(?, sort_order)
    WHERE id = ? AND user_id = ?
  `).run(name, emoji, sort_order, req.params.id, req.userId);
  res.json({ ok: true });
});

// DELETE /folders/:id
router.delete('/:id', (req, res) => {
  getDb().prepare('DELETE FROM chat_folders WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.userId);
  res.json({ ok: true });
});

// POST /folders/:id/chats — добавить чат в папку
router.post('/:id/chats', (req, res) => {
  const { chatId } = req.body;
  const db = getDb();
  // Проверить что пользователь — участник чата
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?')
    .get(chatId, req.userId);
  if (!member) return res.status(403).json({ error: 'Not a member' });
  db.prepare('INSERT OR IGNORE INTO chat_folder_members (folder_id, chat_id) VALUES (?, ?)')
    .run(req.params.id, chatId);
  res.json({ ok: true });
});

// DELETE /folders/:id/chats/:chatId — убрать чат из папки
router.delete('/:id/chats/:chatId', (req, res) => {
  getDb().prepare('DELETE FROM chat_folder_members WHERE folder_id = ? AND chat_id = ?')
    .run(req.params.id, req.params.chatId);
  res.json({ ok: true });
});

export default router;
```

---

### D4. Групповые звонки (до 8 участников)

**Приоритет:** P1  
**Суть:** Текущий WebRTC — только 1-на-1 (mesh). Для группового звонка нужна SFU (Selective Forwarding Unit) архитектура через LiveKit или mediasoup.

**Рекомендация:** Использовать [LiveKit Cloud](https://livekit.io/cloud) — бесплатный тариф на 50 участников/месяц. Избегает сложности написания своего SFU.

#### Шаг 1: Установить LiveKit SDK

```bash
cd backend && npm install livekit-server-sdk
cd web && npm install @livekit/components-react @livekit/client
```

#### Шаг 2: Backend — endpoint генерации токена комнаты

```javascript
// backend/src/routes/calls.js — добавить:
import { AccessToken } from 'livekit-server-sdk';

const LK_API_KEY    = process.env.LIVEKIT_API_KEY;
const LK_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LK_URL        = process.env.LIVEKIT_URL; // wss://your-project.livekit.cloud

router.post('/group-token', authMiddleware, async (req, res) => {
  const { chatId } = req.body;
  
  // Проверить что пользователь — участник чата
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?')
    .get(chatId, req.userId);
  if (!member) return res.status(403).json({ error: 'Not a member' });
  
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.userId);
  
  const at = new AccessToken(LK_API_KEY, LK_API_SECRET, {
    identity: String(req.userId),
    name: user.username,
    ttl: '1h',
  });
  at.addGrant({
    roomJoin: true,
    room: `chat-${chatId}`,
    canPublish: true,
    canSubscribe: true,
  });
  
  res.json({ token: await at.toJwt(), url: LK_URL });
});
```

#### Шаг 3: Frontend — GroupCallRoom компонент

```typescript
// web/src/components/GroupCallRoom.tsx
import {
  LiveKitRoom,
  VideoConference,
  RoomAudioRenderer,
} from '@livekit/components-react';
import '@livekit/components-styles';

interface GroupCallRoomProps {
  token: string;
  serverUrl: string;
  onLeave: () => void;
}

export function GroupCallRoom({ token, serverUrl, onLeave }: GroupCallRoomProps) {
  return (
    <LiveKitRoom
      video={true}
      audio={true}
      token={token}
      serverUrl={serverUrl}
      onDisconnected={onLeave}
      style={{ height: '100vh' }}
    >
      <VideoConference />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}
```

Добавить переменные окружения:
```bash
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_URL=wss://your-project.livekit.cloud
```

---

### D5. PWA: Service Worker + Offline режим

**Приоритет:** P1  
**Суть:** Приложение должно загружаться и показывать кэшированные чаты даже без интернета.

#### Установить Vite PWA плагин

```bash
cd web && npm install -D vite-plugin-pwa
```

#### `web/vite.config.ts` — добавить плагин

```typescript
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'logo192.png'],
      manifest: {
        name: 'Blizkie',
        short_name: 'Blizkie',
        description: 'Приватный мессенджер',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'logo192.png', sizes: '192x192', type: 'image/png' },
          { src: 'logo512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.blizkie\.ru\/chats/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-chats',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
});
```

#### `web/public/manifest.json` (создать)

```json
{
  "name": "Blizkie",
  "short_name": "Blizkie",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#1a1a2e",
  "theme_color": "#7c4dff",
  "description": "Приватный мессенджер",
  "icons": [
    { "src": "logo192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "logo512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

---

### D6. AI-функции

**Приоритет:** P2  
**Суть:** Краткое содержание пропущенных сообщений + умные ответы.

#### Backend: `backend/src/routes/ai.js`

```javascript
import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { authMiddleware } from '../middleware/auth.js';
import { getDb } from '../config/database.js';
import { decrypt } from '../crypto/aes.js';
import rateLimit from 'express-rate-limit';

const router = Router();
router.use(authMiddleware);
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const aiLimiter = rateLimit({ windowMs: 60_000, max: 10 }); // 10 запросов/мин

// POST /ai/summarize — краткое содержание чата
router.post('/summarize', aiLimiter, async (req, res) => {
  const { chatId, messageCount = 50 } = req.body;
  const db = getDb();
  
  // Проверить доступ к чату
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?')
    .get(chatId, req.userId);
  if (!member) return res.status(403).json({ error: 'Forbidden' });
  
  // Получить последние N сообщений
  const messages = db.prepare(`
    SELECT m.*, u.username FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.chat_id = ? AND m.deleted_at IS NULL
    ORDER BY m.created_at DESC LIMIT ?
  `).all(chatId, Math.min(messageCount, 100));
  
  const lines = messages.reverse().map(msg => {
    let text = '';
    if (msg.ciphertext) {
      try { text = decrypt({ ciphertext: msg.ciphertext, iv: msg.iv, authTag: msg.auth_tag }); }
      catch { text = '[attachment]'; }
    }
    return `${msg.username}: ${text || '[attachment]'}`;
  }).join('\n');
  
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: 'Ты помогаешь пользователю понять что пропустил в переписке. Дай краткое содержание (3-5 предложений) на русском языке. Не упоминай имена пользователей без необходимости.',
    messages: [{ role: 'user', content: `Переписка:\n${lines}\n\nКраткое содержание:` }],
  });
  
  res.json({ summary: response.content[0].text });
});

// POST /ai/suggest-replies — умные ответы
router.post('/suggest-replies', aiLimiter, async (req, res) => {
  const { chatId, lastMessageId } = req.body;
  const db = getDb();
  
  const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND chat_id = ?')
    .get(lastMessageId, chatId);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  
  let text = '';
  if (msg.ciphertext) {
    try { text = decrypt({ ciphertext: msg.ciphertext, iv: msg.iv, authTag: msg.auth_tag }); }
    catch { return res.json({ suggestions: [] }); }
  }
  
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 128,
    system: 'Предложи 3 коротких варианта ответа на сообщение. Каждый вариант — одна строка. Отвечай на том же языке что и сообщение.',
    messages: [{ role: 'user', content: `Сообщение: "${text}"\n\nВарианты ответа (по одному на строке):` }],
  });
  
  const suggestions = response.content[0].text
    .split('\n')
    .map(s => s.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3);
  
  res.json({ suggestions });
});

export default router;
```

Добавить в env:
```bash
ANTHROPIC_API_KEY=sk-ant-...
```

---

### D7. Экспорт истории (GDPR)

**Приоритет:** P1  
**Суть:** Пользователь может скачать всю свою историю переписки в JSON или HTML.

#### Backend: `backend/src/routes/export.js`

```javascript
import { Router } from 'express';
import { getDb } from '../config/database.js';
import { decrypt } from '../crypto/aes.js';
import { authMiddleware } from '../middleware/auth.js';
import archiver from 'archiver'; // npm install archiver
import rateLimit from 'express-rate-limit';

const router = Router();
router.use(authMiddleware);

// Максимум 1 экспорт в час
const exportLimiter = rateLimit({ windowMs: 3600_000, max: 1 });

router.get('/my-data', exportLimiter, async (req, res) => {
  const db = getDb();
  const userId = req.userId;
  
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="blizkie-export-${Date.now()}.zip"`);
  
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(res);
  
  // Профиль
  const user = db.prepare('SELECT id, username, email, created_at FROM users WHERE id = ?').get(userId);
  archive.append(JSON.stringify(user, null, 2), { name: 'profile.json' });
  
  // Все чаты с сообщениями
  const chats = db.prepare(`
    SELECT c.id, c.type, c.name FROM chats c
    JOIN chat_members cm ON cm.chat_id = c.id
    WHERE cm.user_id = ?
  `).all(userId);
  
  for (const chat of chats) {
    const messages = db.prepare(`
      SELECT m.*, u.username as sender_name FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.chat_id = ? AND m.deleted_at IS NULL
      ORDER BY m.created_at
    `).all(chat.id);
    
    const decrypted = messages.map(msg => {
      let text = null;
      if (msg.ciphertext) {
        try { text = decrypt({ ciphertext: msg.ciphertext, iv: msg.iv, authTag: msg.auth_tag }); }
        catch { text = '[encrypted]'; }
      }
      return {
        id: msg.id,
        sender: msg.sender_name,
        text,
        createdAt: new Date(msg.created_at).toISOString(),
        type: msg.type,
        attachmentUrl: msg.attachment_url || null,
      };
    });
    
    const chatName = chat.name || `direct-${chat.id}`;
    archive.append(JSON.stringify(decrypted, null, 2), {
      name: `chats/${chatName}-${chat.id}.json`,
    });
  }
  
  archive.finalize();
});

export default router;
```

---

### D8. Stories / Статусы с медиа

**Приоритет:** P2  
**Суть:** Короткоживущий (24ч) контент, видимый только друзьям.

#### Миграция `008_stories.js`

```javascript
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stories (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      media_url    TEXT NOT NULL,
      media_type   TEXT NOT NULL CHECK(media_type IN ('image', 'video')),
      caption      TEXT,
      created_at   INTEGER DEFAULT (unixepoch('now') * 1000),
      expires_at   INTEGER NOT NULL   -- created_at + 86400000
    );

    CREATE TABLE IF NOT EXISTS story_views (
      story_id   INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      viewer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      viewed_at  INTEGER DEFAULT (unixepoch('now') * 1000),
      PRIMARY KEY (story_id, viewer_id)
    );

    CREATE INDEX IF NOT EXISTS idx_stories_user_expires
      ON stories(user_id, expires_at);
  `);
}
```

#### Routes `backend/src/routes/stories.js`

```javascript
// GET /stories — stories от друзей, не просмотренные пользователем
router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  const stories = db.prepare(`
    SELECT s.*, u.username, u.avatar_url,
           (SELECT 1 FROM story_views sv WHERE sv.story_id = s.id AND sv.viewer_id = ?) AS viewed
    FROM stories s
    JOIN users u ON u.id = s.user_id
    JOIN friends f ON (f.user_id = ? AND f.friend_id = s.user_id)
                   OR (f.friend_id = ? AND f.user_id = s.user_id)
    WHERE s.expires_at > ? AND s.user_id != ?
    ORDER BY s.created_at DESC
  `).all(req.userId, req.userId, req.userId, Date.now(), req.userId);
  res.json(stories);
});

// POST /stories/:id/view — отметить просмотр
router.post('/:id/view', authMiddleware, (req, res) => {
  getDb().prepare('INSERT OR IGNORE INTO story_views (story_id, viewer_id) VALUES (?, ?)')
    .run(req.params.id, req.userId);
  res.json({ ok: true });
});
```

---

### D9. WebAuthn / Passkeys

**Приоритет:** P2  
**Суть:** Вход без пароля через биометрию (Touch ID, Face ID, Windows Hello).

#### Зависимости

```bash
cd backend && npm install @simplewebauthn/server
cd web && npm install @simplewebauthn/browser
```

#### Миграция `009_webauthn.js`

```javascript
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS webauthn_credentials (
      id                TEXT PRIMARY KEY,   -- credentialID (base64url)
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      public_key        TEXT NOT NULL,      -- COSE public key
      counter           INTEGER DEFAULT 0,  -- replay protection
      device_name       TEXT,
      created_at        INTEGER DEFAULT (unixepoch('now') * 1000),
      last_used_at      INTEGER
    );

    CREATE TABLE IF NOT EXISTS webauthn_challenges (
      challenge   TEXT PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id),
      type        TEXT CHECK(type IN ('registration', 'authentication')),
      expires_at  INTEGER NOT NULL
    );
  `);
}
```

#### Backend: `backend/src/routes/webauthn.js`

```javascript
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';

const RP_ID   = new URL(process.env.APP_URL).hostname;
const RP_NAME = 'Blizkie';
const ORIGIN  = process.env.APP_URL;

// POST /webauthn/register/options — начать регистрацию passkey
router.post('/register/options', authMiddleware, async (req, res) => {
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.userId);
  const existing = db.prepare('SELECT id FROM webauthn_credentials WHERE user_id = ?').all(req.userId);
  
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: String(user.id),
    userName: user.username,
    excludeCredentials: existing.map(c => ({ id: c.id, type: 'public-key' })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  
  // Сохранить challenge
  db.prepare('INSERT INTO webauthn_challenges (challenge, user_id, type, expires_at) VALUES (?, ?, ?, ?)')
    .run(options.challenge, req.userId, 'registration', Date.now() + 300_000);
  
  res.json(options);
});

// POST /webauthn/register/verify — завершить регистрацию
router.post('/register/verify', authMiddleware, async (req, res) => {
  const { body, deviceName } = req.body;
  const ch = db.prepare('SELECT * FROM webauthn_challenges WHERE user_id = ? AND type = ?')
    .get(req.userId, 'registration');
  if (!ch || ch.expires_at < Date.now()) return res.status(400).json({ error: 'Challenge expired' });
  
  const verification = await verifyRegistrationResponse({
    response: body, expectedChallenge: ch.challenge,
    expectedOrigin: ORIGIN, expectedRPID: RP_ID,
  });
  
  if (!verification.verified) return res.status(400).json({ error: 'Verification failed' });
  
  const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
  
  db.prepare('INSERT INTO webauthn_credentials (id, user_id, public_key, counter, device_name) VALUES (?, ?, ?, ?, ?)')
    .run(credentialID, req.userId, Buffer.from(credentialPublicKey).toString('base64'), counter, deviceName || 'Passkey');
  
  db.prepare('DELETE FROM webauthn_challenges WHERE user_id = ? AND type = ?').run(req.userId, 'registration');
  
  res.json({ ok: true });
});
```

---

## ЧАСТЬ 6. ФАЗА E — КАЧЕСТВО КОДА

---

### E1. Интеграционные тесты

**Приоритет:** P1  
**Инструмент:** Vitest (уже в стеке фронтенда) + supertest для бэкенда

#### Добавить в `backend/package.json`

```json
{
  "devDependencies": {
    "vitest": "^1.0.0",
    "supertest": "^6.3.0",
    "@vitest/coverage-v8": "^1.0.0"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

#### Пример теста `backend/tests/auth.test.js`

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/index.js';

let app;

beforeAll(async () => {
  process.env.DB_PATH = ':memory:';
  process.env.JWT_SECRET = 'test-secret-at-least-32-chars-long!!';
  process.env.MESSAGE_ENCRYPTION_KEY = '0'.repeat(64);
  process.env.NODE_ENV = 'test';
  app = await createApp();
});

describe('POST /auth/login', () => {
  it('rejects invalid credentials with 401', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'nobody', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  it('does not distinguish user-not-found vs wrong-password', async () => {
    const res1 = await request(app).post('/auth/login').send({ username: 'nobody', password: 'wrong' });
    const res2 = await request(app).post('/auth/login').send({ username: 'also-nobody', password: 'other' });
    expect(res1.body.error).toBe(res2.body.error); // одинаковое сообщение
  });
});

describe('POST /auth/refresh', () => {
  it('returns 401 without refresh token cookie', async () => {
    const res = await request(app).post('/auth/refresh');
    expect(res.status).toBe(401);
  });
});
```

---

### E2. OpenAPI документация

**Инструмент:** `swagger-jsdoc` + `swagger-ui-express`

```bash
cd backend && npm install swagger-jsdoc swagger-ui-express
```

В `backend/src/index.js`:

```javascript
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

if (NODE_ENV !== 'production') {
  const spec = swaggerJsdoc({
    definition: {
      openapi: '3.0.0',
      info: { title: 'Blizkie API', version: '1.0.0' },
      servers: [{ url: `http://localhost:${PORT}` }],
    },
    apis: ['./src/routes/*.js'],
  });
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec));
}
```

Добавлять JSDoc аннотации к каждому роуту:

```javascript
/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Вход в систему
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username: { type: string }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Успешный вход
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string }
 *       401:
 *         description: Неверные данные
 */
router.post('/login', loginLimiter, async (req, res) => { ... });
```

---

### E3. Мониторинг (Sentry)

```bash
cd backend && npm install @sentry/node
cd web && npm install @sentry/react
```

**Backend `backend/src/index.js`:**

```javascript
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: NODE_ENV,
    tracesSampleRate: 0.1, // 10% транзакций
  });
  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.tracingHandler());
}

// В errorHandler.js — перед отправкой ответа:
if (status >= 500 && process.env.SENTRY_DSN) {
  Sentry.captureException(err);
}
```

Добавить переменную:
```bash
SENTRY_DSN=https://...@sentry.io/...
```

---

## ЧАСТЬ 7. КОНФИГУРАЦИЯ И ДЕПЛОЙ

### 7.1 Итоговый список новых переменных окружения

```bash
# Refresh tokens
REFRESH_TOKEN_SECRET=<64+ символов, отличается от JWT_SECRET>

# LiveKit групповые звонки
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_URL=wss://your-project.livekit.cloud

# AI функции
ANTHROPIC_API_KEY=sk-ant-...

# Мониторинг
SENTRY_DSN=https://...@sentry.io/...

# Бэкапы (использует существующие S3 vars)
S3_BACKUP_PREFIX=backups/
```

### 7.2 Итоговый список новых npm зависимостей

**Backend:**

| Пакет | Назначение | Команда |
|---|---|---|
| `node-cron` | Фоновые воркеры | `npm i node-cron` |
| `archiver` | ZIP экспорт | `npm i archiver` |
| `ipaddr.js` | SSRF защита | `npm i ipaddr.js` |
| `livekit-server-sdk` | Групповые звонки | `npm i livekit-server-sdk` |
| `@simplewebauthn/server` | Passkeys | `npm i @simplewebauthn/server` |
| `@anthropic-ai/sdk` | AI функции | `npm i @anthropic-ai/sdk` |
| `@sentry/node` | Мониторинг | `npm i @sentry/node` |
| `swagger-jsdoc` | OpenAPI docs | `npm i swagger-jsdoc` |
| `swagger-ui-express` | API docs UI | `npm i swagger-ui-express` |
| `supertest` (dev) | Интеграционные тесты | `npm i -D supertest` |
| `vitest` (dev) | Test runner | `npm i -D vitest` |

**Frontend:**

| Пакет | Назначение | Команда |
|---|---|---|
| `@livekit/client` | Групповые звонки | `npm i @livekit/client` |
| `@livekit/components-react` | UI компоненты LiveKit | `npm i @livekit/components-react` |
| `@simplewebauthn/browser` | Passkeys | `npm i @simplewebauthn/browser` |
| `@sentry/react` | Мониторинг | `npm i @sentry/react` |
| `vite-plugin-pwa` (dev) | PWA / Service Worker | `npm i -D vite-plugin-pwa` |

### 7.3 Новые файлы (полный список)

```
backend/src/
├── routes/
│   ├── health.js              # A1
│   ├── folders.js             # D3
│   ├── stories.js             # D8
│   ├── webauthn.js            # D9
│   ├── ai.js                  # D6
│   └── export.js              # D7
├── workers/
│   ├── index.js               # Запускает все воркеры
│   ├── scheduledMessages.js   # A3
│   ├── s3Cleanup.js           # A5
│   ├── ephemeralMessages.js   # D2
│   └── dbBackup.js            # C2
└── db/
    ├── migrate.js             # C1 движок
    └── versions/
        ├── 001_initial.js
        ├── 002_refresh_tokens.js
        ├── 003_s3_delete_queue.js
        ├── 004_admins.js
        ├── 005_voice_messages.js
        ├── 006_ephemeral_messages.js
        ├── 007_chat_folders.js
        ├── 008_stories.js
        └── 009_webauthn.js

backend/scripts/
└── createAdmin.js             # B3

backend/tests/
├── auth.test.js
├── messages.test.js
└── upload.test.js

web/src/
├── components/
│   ├── VoiceRecorder.tsx      # D1
│   ├── VoiceMessage.tsx       # D1
│   ├── GroupCallRoom.tsx      # D4
│   └── StoriesBar.tsx         # D8
└── api/
    ├── folders.ts             # D3
    ├── stories.ts             # D8
    ├── ai.ts                  # D6
    └── export.ts              # D7
```

---

## ЧАСТЬ 8. ЧЕКЛИСТ ПО ФАЗАМ

### Фаза A — Критические исправления

- [x] **A1** — `GET /health` возвращает `{"status":"ok"}` и проверяет БД (коммит `30689cff`)
- [x] **A1** — Роут вынесен в `backend/src/routes/health.js`, подключён первым в `index.js`
- [ ] **A1** — UptimeRobot настроен на `https://<amvera-domain>/health`, алерт включён
- [x] **A2** — SIGTERM запускает graceful shutdown, логирует этапы (коммит `27b42522`)
- [x] **A2** — DB закрывается корректно перед выходом (WAL checkpoint + db.close())
- [x] **A3** — Воркер scheduled messages запускается при старте Socket.IO (setInterval 30 с, socketServer.js:388)
- [x] **A3** — Сообщения с `deliver_at` в прошлом доставляются через Socket.IO + Web Push (messageService.js:243)
- [x] **A4** — `join-chat` проверяет членство в БД, чужие чат-комнаты недоступны (коммит `f82c9ee7`)
- [x] **A4** — `call:invite` не позволяет более 5 звонков в минуту на userId (коммит `f82c9ee7`)
- [x] **A4** — `typing-start` уже был throttled на 1500 мс — изменений не требовалось
- [x] **A4** — `send-message` / `message-reaction` идут через HTTP, не Socket.IO — socket-лимит не нужен
- [ ] **A5** — S3 delete ошибки логируются в logger.warn
- [ ] **A5** — Failed deletes повторяются через `s3_delete_queue`

### Фаза B — Безопасность

- [x] **B1** — Access token истекает через 15 минут (signAccess 15m)
- [x] **B1** — `POST /auth/refresh` выдаёт новый access token + rotated refresh token
- [x] **B1** — Refresh token rotation: старый отзывается, новый записывается в DB
- [x] **B1** — Replay detection: повторное использование revoked-токена → revoke сессии
- [x] **B1** — Rate limit на /auth/refresh: 60 req / 15 min per IP
- [x] **B1** — Frontend interceptor ловит 401, рефрешит, сохраняет новый refreshToken, ретраит
- [x] **B2** — 3 регистрации с одного IP в час — лимит работает (registrationLimiter)
- [x] **B3** — CLI `npm run create-admin` создаёт пользователя и выводит ADMIN_PASSWORD_HASH
- [x] **B3** — Панель администратора полностью перестроена (Toast, Confirm, 7 страниц)
- [ ] **B4** — 5+ `call:invite` в минуту возвращают `TOO_MANY_CALLS`
- [x] **B5** — Запрос к `http://169.254.169.254` через link preview — блокируется (linkLocal range)
- [x] **B5** — Запрос к `http://localhost` через link preview — блокируется (hostname + loopback)
- [x] **B5** — Redirect на внутренний IP блокируется (manual redirect + re-validation)
- [x] **B5** — IPv4-mapped IPv6 (::ffff:127.0.0.1) блокируется (ipaddr.process)
- [x] **B5** — Non-standard ports (6379, 8080, ...) блокируются

### Фаза C — Инфраструктура

- [ ] **C1** — Таблица `schema_migrations` создаётся при старте
- [ ] **C1** — Повторный запуск не применяет уже примененные миграции
- [ ] **C1** — Новая миграция применяется автоматически при добавлении файла
- [ ] **C2** — S3_BUCKET установлен — бэкап создаётся ежедневно в 03:00 UTC
- [ ] **C2** — Бэкапы старше 30 дней удаляются автоматически

### Фаза D — Функционал

- [ ] **D1** — Голосовое сообщение записывается кнопкой в инпуте
- [ ] **D1** — Waveform отображается при воспроизведении
- [ ] **D2** — Сообщение с `expires_in=60` удаляется через 60 секунд
- [ ] **D2** — `chat-updated` событие отражает изменение `default_ttl`
- [ ] **D3** — Папки создаются, чаты добавляются/удаляются
- [ ] **D3** — Фильтрация по папке на фронтенде работает
- [ ] **D4** — Токен LiveKit выдаётся при вызове `/calls/group-token`
- [ ] **D4** — GroupCallRoom рендерит сетку участников
- [ ] **D5** — `npm run build` создаёт Service Worker
- [ ] **D5** — Приложение загружается в Chrome DevTools с отключённой сетью
- [ ] **D6** — `/ai/summarize` возвращает краткое содержание
- [ ] **D6** — `/ai/suggest-replies` возвращает 3 варианта
- [ ] **D7** — ZIP архив скачивается и содержит корректный JSON
- [ ] **D8** — Stories видны только друзьям, исчезают через 24ч
- [ ] **D9** — Passkey регистрируется, вход с passkey работает

### Фаза E — Качество

- [ ] **E1** — `npm test` проходит без ошибок
- [ ] **E1** — Покрытие auth роутов > 80%
- [ ] **E2** — `/api-docs` открывается в dev режиме
- [ ] **E3** — Ошибки 500 отправляются в Sentry (если DSN установлен)

---

## ЧАСТЬ 9. ПРИОРИТЕТЫ ИСПРАВЛЕНИЯ — МАТРИЦА

| ID | Задача | Фаза | Усилие | Риск без неё | Статус |
|---|---|---|---|---|---|
| A1 | Health check | A | 30 мин | Нестабильный деплой | ✅ |
| A2 | Graceful shutdown | A | 1ч | Потеря данных при деплое | ✅ |
| A3 | Scheduled messages worker | A | — | Функция нерабочая | ✅ |
| A4 | Socket.IO rate limits | A | 2ч | DoS уязвимость | ✅ |
| A5 | S3 retry + logging | A | 1.5ч | Утечка данных в S3 | ✅ |
| B1 | Refresh tokens | B | 4ч | 30-дневная уязвимость | ✅ |
| B2 | Reg rate limit | B | 30 мин | Спам аккаунтов | ✅ |
| B3 | Admin user table | B | 3ч | Небезопасный admin | ✅ |
| B4 | Call spam protection | B | 1ч | DoS на UI | ⬜ |
| B5 | SSRF защита | B | 1.5ч | Инфра утечка | ✅ |
| C1 | Миграции версии | C | 3ч | Хрупкие обновления | ✅ |
| C2 | DB backup | C | 2ч | Потеря всех данных | ✅ |
| D1 | Голосовые сообщения | D | 8ч | Конкурентное отставание | ⬜ |
| D2 | Ephemeral messages | D | 4ч | Конкурентное отставание | ⬜ |
| D3 | Папки чатов | D | 5ч | UX | ⬜ |
| D4 | Групповые звонки | D | 6ч | Конкурентное отставание | ⬜ |
| D5 | PWA offline | D | 4ч | UX на мобильных | ⬜ |
| D6 | AI функции | D | 4ч | Инновации | ⬜ |
| D7 | GDPR export | D | 3ч | Юридический риск в EU | ⬜ |
| D8 | Stories | D | 6ч | UX / вовлечённость | ⬜ |
| D9 | Passkeys | D | 5ч | UX безопасности | ⬜ |
| E1 | Интеграционные тесты | E | 8ч | Регрессии | ⬜ |
| E2 | OpenAPI docs | E | 4ч | Поддерживаемость | ⬜ |
| E3 | Sentry мониторинг | E | 1ч | Слепые пятна в prod | ⬜ |

**Итого оценочное время:** ~88 часов разработки

---

## ПРИЛОЖЕНИЕ: Полезные команды

```bash
# Запустить бэкенд локально
cd backend && npm run dev

# Запустить фронтенд локально
cd web && npm run dev

# Запустить тесты
cd backend && npm test

# Собрать фронтенд
cd web && npm run build

# Создать первого admin
cd backend && node scripts/createAdmin.js admin yourpassword

# Проверить health локально
curl http://localhost:3000/health
# Ожидаемый ответ: {"status":"ok","timestamp":"...","uptime":N,"db":"ok"}

# Проверить health на Amvera (prod)
curl https://<amvera-domain>/health

# Проверить что refresh работает
curl -c cookies.txt -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"test","password":"test123"}'
curl -b cookies.txt -X POST http://localhost:3000/auth/refresh

# Применить новую миграцию (просто перезапустить сервер)
# Миграции применяются автоматически при старте
```

### Amvera-специфичные команды

```bash
# Установить Amvera CLI (если не установлен)
pip install amvera-cli   # или через официальный инсталлер

# Посмотреть логи деплоя (последние 100 строк)
amvera logs --project blizkie --tail 100

# Перезапустить приложение вручную
amvera restart --project blizkie

# Посмотреть переменные окружения (только ключи)
amvera env list --project blizkie

# Задеплоить новую версию (push в git → автодеплой)
git push origin devDK
# Amvera подхватит изменения автоматически при подключённом CI

# Проверить статус контейнера
amvera status --project blizkie
```

---

*Документ составлен по результатам аудита кодовой базы ветки `devDK` от 2026-04-30.*  
*Платформа деплоя: Amvera (бэкенд) + Vercel (фронтенд).*  
*При любых вопросах по реализации — обращаться к этому ТЗ как к основному источнику истины.*
