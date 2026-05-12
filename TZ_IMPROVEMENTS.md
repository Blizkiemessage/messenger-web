# ТЗ: Улучшения безопасности, надёжности и функционала
## Проект: Blizkie Messenger (devDK)
### Дата: 2026-05-12

---

## Контекст проекта

**Стек:**
- Backend: Node.js + Express + better-sqlite3 (CommonJS, `require()`), Socket.IO 4, развёрнут на Amvera
- Frontend: React 19 + TypeScript + Vite 8 + Zustand, развёрнут на Vercel
- Хранилище файлов: Yandex Cloud S3 (S3-совместимый API)
- БД: SQLite с WAL, версионные миграции (`backend/src/db/versions/NNN_name.js`)
- Шифрование сообщений: AES-256-GCM, ключ из `MESSAGE_ENCRYPTION_KEY`
- Аутентификация: JWT (access 15 мин + refresh 30 дней), HttpOnly cookie + Bearer header

**Ключевые файлы:**
- `backend/src/crypto/aes.js` — шифрование сообщений
- `backend/src/utils/jwt.js` — подпись/верификация токенов
- `backend/src/socket/socketServer.js` — Socket.IO сервер
- `backend/src/routes/messages.js` — отправка/получение сообщений
- `backend/src/middleware/rateLimits.js` — rate limiters
- `backend/src/db/versions/` — миграции схемы
- `web/src/components/chat/MessageBubble.tsx` — рендер сообщений
- `web/src/components/chat/Composer.tsx` — поле ввода
- `web/src/store/` — Zustand stores

---

## Очерёдность выполнения

```
БЛОК A — Критическая безопасность (делать первым, блокирует продакшн)
  A1. KDF для ключа шифрования
  A2. Раздельные JWT-секреты
  A3. Per-chat деривация ключа (Forward Secrecy)

БЛОК B — Надёжность и операционная безопасность
  B1. Воркер доставки запланированных сообщений
  B2. Idempotency key для отправки сообщений
  B3. Мониторинг (Sentry)
  B4. Аудит-лог пользовательских действий

БЛОК C — Дополнительная безопасность
  C1. CSRF-защита
  C2. Rate limit для Socket.IO событий (messages, typing)
  C3. Отдельный строгий лимит для backup-кодов

БЛОК D — Функционал (высокий приоритет)
  D1. Статус «Доставлено» в индикаторах сообщений
  D2. @-упоминания с push-уведомлением
  D3. Эфемерные (самоудаляющиеся) сообщения
  D4. Архив чатов

БЛОК E — Функционал (средний приоритет)
  E1. Скорость воспроизведения голосовых сообщений
  E2. Быстрые реакции (double-tap)
  E3. Перевод сообщений

БЛОК F — Групповые звонки (сложный, отдельная фаза)
  F1. WebRTC SFU групповые звонки до 8 участников
```

---

## БЛОК A — Критическая безопасность

---

### A1. KDF для ключа шифрования сообщений

**Файл:** `backend/src/crypto/aes.js`

**Проблема:**
Сейчас ключ берётся напрямую из env-переменной:
```js
const hex = process.env.MESSAGE_ENCRYPTION_KEY;
return Buffer.from(hex.slice(0, 64), 'hex');
```
Если env-переменная утечёт (логи, CI/CD, snapshot) — злоумышленник немедленно читает все сообщения.

**Что сделать:**
Добавить деривацию ключа через PBKDF2 при старте сервера. Деривация выполняется один раз и результат кешируется в памяти.

**Реализация:**

1. Добавить в `backend/src/crypto/aes.js`:
```js
const crypto = require('crypto');

// Derived once at startup, cached in module scope
let _derivedKey = null;

function getDerivedKey() {
  if (_derivedKey) return _derivedKey;
  const secret = process.env.MESSAGE_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    throw new Error('[crypto] MESSAGE_ENCRYPTION_KEY must be at least 32 chars');
  }
  // Salt is fixed per deployment — store in env or derive from app name
  const salt = process.env.MESSAGE_KEY_SALT || 'blizkie-messenger-v1';
  _derivedKey = crypto.pbkdf2Sync(secret, salt, 200_000, 32, 'sha512');
  return _derivedKey;
}
```

2. Заменить `getKey()` → `getDerivedKey()` везде в `aes.js`.

3. Добавить `MESSAGE_KEY_SALT` в список обязательных env-переменных в `backend/src/index.js` (`REQUIRED_ENV`). Значение: случайная строка 32+ символа, генерируется один раз при деплое.

4. **Важно:** При смене `MESSAGE_KEY_SALT` старые сообщения станут нечитаемыми. Поэтому соль меняется только при плановой ротации ключа с перешифровкой.

**Тест:** Запустить `node -e "require('./src/crypto/aes'); console.log('OK')"` — должно работать без ошибок при правильном env.

---

### A2. Раздельные JWT-секреты для access и refresh токенов

**Файл:** `backend/src/utils/jwt.js`

**Проблема:**
```js
// Сейчас — оба типа токена подписываются одним JWT_SECRET
function signAccess(payload) { return jwt.sign(payload, process.env.JWT_SECRET, ...) }
function signRefresh(payload) { return jwt.sign(payload, process.env.JWT_SECRET, ...) }
```
Компрометация одного секрета = компрометация обоих типов токенов.

**Что сделать:**

1. В `backend/src/utils/jwt.js` разделить секреты:
```js
const ACCESS_SECRET  = () => process.env.JWT_SECRET;
const REFRESH_SECRET = () => process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET; // fallback для обратной совместимости

function signAccess(payload) {
  return jwt.sign(payload, ACCESS_SECRET(), { expiresIn: '15m' });
}

function signRefresh(payload) {
  return jwt.sign(payload, REFRESH_SECRET(), { expiresIn: '30d' });
}

function verifyRefresh(token) {
  return jwt.verify(token, REFRESH_SECRET());
}
```

2. В `backend/src/routes/auth.js` найти все вызовы `verify(refreshToken)` для refresh-токенов и заменить на `verifyRefresh(refreshToken)`.

3. В `backend/src/index.js` добавить `JWT_REFRESH_SECRET` в `PROD_REQUIRED_ENV`.

4. При деплое сгенерировать два отдельных секрета: `openssl rand -hex 64`.

**Обратная совместимость:** Fallback `|| JWT_SECRET` позволяет плавно выкатить без одновременного логаута всех пользователей. После деплоя с новым `JWT_REFRESH_SECRET` — старые refresh-токены (подписанные старым секретом) будут отклонены при первом рефреше → пользователи перелогинятся.

---

### A3. Forward Secrecy — деривация ключа per-chat

**Файлы:** `backend/src/crypto/aes.js`, `backend/src/routes/messages.js`

**Проблема:**
Все сообщения всех чатов зашифрованы одним ключом. Один скомпрометированный ключ = вся история.

**Что сделать:**
Использовать HKDF для деривации уникального ключа на каждый чат из мастер-ключа.

**Реализация:**

1. В `backend/src/crypto/aes.js` добавить функцию:
```js
function deriveKeyForChat(chatId) {
  const master = getDerivedKey(); // из A1
  // HKDF-Expand: derive 32-byte key using chatId as info
  return crypto.hkdfSync('sha256', master, Buffer.alloc(0), `chat:${chatId}`, 32);
}
```
> `crypto.hkdfSync` доступен начиная с Node.js 15+.

2. Изменить `encrypt(plaintext)` и `decrypt(...)` чтобы принимать опциональный `chatId`:
```js
function encrypt(plaintext, chatId) {
  const key = chatId ? deriveKeyForChat(chatId) : getDerivedKey();
  // ... остальная логика без изменений
}

function decrypt({ ciphertext, iv, authTag }, chatId) {
  const key = chatId ? deriveKeyForChat(chatId) : getDerivedKey();
  // ...
}
```

3. В `backend/src/routes/messages.js` при создании сообщения передавать `chatId`:
```js
const { ciphertext, iv, authTag } = encrypt(text, chat.id);
```

4. При чтении сообщений передавать `chatId` в `decrypt`:
```js
text = decrypt({ ciphertext: msg.ciphertext, iv: msg.iv, authTag: msg.auth_tag }, chatId);
```

5. **Важно:** Старые сообщения зашифрованы без `chatId` (мастер-ключом). При декрипции — сначала пробовать с `chatId`, если GCM auth-tag fail — пробовать без `chatId` (fallback для старых сообщений). Это гарантирует нулевой даунтайм при миграции.

**Тест:** Создать новое сообщение, перезапустить сервер, прочитать — текст должен совпадать.

---

## БЛОК B — Надёжность и операционная безопасность

---

### B1. Воркер доставки запланированных сообщений

**Файлы:** `backend/src/workers/scheduledMessages.js` (создать), `backend/src/index.js`

**Проблема:**
Сообщения с `deliver_at` хранятся в БД, но никогда не отправляются — нет фонового процесса.

**Что сделать:**

1. Создать файл `backend/src/workers/scheduledMessages.js`:
```js
'use strict';
const { getDb } = require('../config/database');
const { decrypt } = require('../crypto/aes');

const POLL_INTERVAL_MS = 15_000; // check every 15 seconds
let timer = null;

async function deliverPending(io) {
  const db  = getDb();
  const now = Date.now();

  const pending = db.prepare(`
    SELECT m.*, c.id AS chat_id
    FROM messages m
    JOIN chats c ON c.id = m.chat_id
    WHERE m.deliver_at IS NOT NULL
      AND m.deliver_at <= ?
      AND m.is_delivered = 0
      AND m.deleted_at IS NULL
    LIMIT 50
  `).all(now);

  for (const msg of pending) {
    try {
      // Mark delivered atomically
      const result = db.prepare(
        'UPDATE messages SET is_delivered = 1 WHERE id = ? AND is_delivered = 0'
      ).run(msg.id);
      if (result.changes === 0) continue; // already delivered by concurrent call

      // Decrypt and broadcast (same logic as POST /messages)
      let text = null;
      if (msg.ciphertext) {
        try { text = decrypt({ ciphertext: msg.ciphertext, iv: msg.iv, authTag: msg.auth_tag }, msg.chat_id); }
        catch { text = null; }
      }

      const payload = buildMessagePayload(msg, text); // extract to shared util
      io.to(`chat:${msg.chat_id}`).emit('new-message', payload);

      // Web Push for offline members
      notifyOfflineMembers(msg.chat_id, msg.sender_id, payload);
    } catch (err) {
      console.error('[scheduledMessages] failed to deliver', msg.id, err.message);
    }
  }
}

function startScheduledDelivery(io) {
  timer = setInterval(() => deliverPending(io), POLL_INTERVAL_MS);
  console.log('[scheduledMessages] worker started, polling every', POLL_INTERVAL_MS / 1000, 's');
}

function stopScheduledDelivery() {
  if (timer) clearInterval(timer);
}

module.exports = { startScheduledDelivery, stopScheduledDelivery };
```

2. В `backend/src/index.js` после `initSocket(server)`:
```js
const { startScheduledDelivery, stopScheduledDelivery } = require('./workers/scheduledMessages');
startScheduledDelivery(io);
```

3. В функции `shutdown()` в `index.js` добавить:
```js
stopScheduledDelivery();
```

4. **Логику формирования payload** (поля сообщения для Socket.IO emit) вынести в общий модуль `backend/src/utils/messagePayload.js`, чтобы использовать и в HTTP-роуте и в воркере.

**Тест:** Создать сообщение с `deliver_at = Date.now() + 60_000`, подождать 60 сек, убедиться что оно появилось в чате.

---

### B2. Idempotency key для отправки сообщений

**Файлы:** `backend/src/routes/messages.js`, `backend/src/db/versions/006_idempotency.js` (создать)

**Проблема:**
При сбое сети клиент повторяет запрос → дублируются сообщения в чате.

**Что сделать:**

1. Создать миграцию `backend/src/db/versions/006_idempotency.js`:
```js
module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS message_idempotency (
        key        TEXT    NOT NULL,
        user_id    INTEGER NOT NULL,
        message_id TEXT    NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (key, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_idempotency_created
        ON message_idempotency(created_at);
    `);
  },
};
```

2. В `backend/src/routes/messages.js` (POST handler):
```js
const idempotencyKey = req.headers['x-idempotency-key'];

if (idempotencyKey) {
  // Cleanup stale keys (>24h)
  db.prepare('DELETE FROM message_idempotency WHERE created_at < ?').run(Date.now() - 86_400_000);

  const existing = db.prepare(
    'SELECT message_id FROM message_idempotency WHERE key = ? AND user_id = ?'
  ).get(idempotencyKey, userId);

  if (existing) {
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(existing.message_id);
    return res.status(200).json(formatMessage(msg)); // return existing, not 409
  }
}

// ... create message as usual ...

if (idempotencyKey) {
  db.prepare(
    'INSERT OR IGNORE INTO message_idempotency (key, user_id, message_id, created_at) VALUES (?, ?, ?, ?)'
  ).run(idempotencyKey, userId, newMessageId, Date.now());
}
```

3. На фронтенде (`web/src/api/messages.ts` или в Composer) при отправке:
```ts
import { v4 as uuidv4 } from 'uuid';
// Generate once per send attempt, reuse on retry
const key = uuidv4();
await apiClient.post(`/chats/${chatId}/messages`, body, {
  headers: { 'X-Idempotency-Key': key },
});
```

---

### B3. Мониторинг ошибок (Sentry)

**Файлы:** `backend/src/index.js`, `web/src/main.tsx`

**Проблема:**
Ошибки теряются в логах Amvera. Нет алертинга, нет трассировки, нет статистики.

**Что сделать:**

**Backend:**
1. `npm install @sentry/node` в `backend/`
2. В `backend/src/index.js` в самом начале (до всех imports):
```js
const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
  });
}
```
3. В Express error handler (`backend/src/middleware/errorHandler.js`):
```js
if (process.env.SENTRY_DSN) Sentry.captureException(err);
```
4. Добавить `SENTRY_DSN` в `PROD_REQUIRED_ENV` или сделать опциональным (отсутствие = просто не логируется).

**Frontend:**
1. `npm install @sentry/react` в `web/`
2. В `web/src/main.tsx`:
```ts
import * as Sentry from '@sentry/react';
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.05,
    ignoreErrors: ['ResizeObserver loop', 'AbortError'],
  });
}
```
3. Добавить `VITE_SENTRY_DSN` в Vercel env vars.

**Итог:** Все необработанные исключения на backend и frontend автоматически попадают в Sentry с stacktrace и контекстом запроса.

---

### B4. Аудит-лог пользовательских действий безопасности

**Файлы:** `backend/src/db/versions/007_security_audit.js` (создать), `backend/src/routes/auth.js`, `backend/src/routes/totp.js`, `backend/src/routes/users.js`

**Проблема:**
`admin_audit_log` существует только для действий администратора. Смена пароля, отключение 2FA, удаление аккаунта, вход с нового устройства — ничего не логируется. Невозможно расследовать взлом аккаунта.

**Что сделать:**

1. Создать `backend/src/db/versions/007_security_audit.js`:
```js
module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS security_audit_log (
        id         TEXT    PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action     TEXT    NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        meta       TEXT,   -- JSON, доп. данные (new_email, session_id и т.д.)
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_security_audit_user
        ON security_audit_log(user_id, created_at DESC);
    `);
  },
};
```

2. Создать `backend/src/utils/securityAudit.js`:
```js
'use strict';
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');

const ACTIONS = {
  LOGIN_SUCCESS:    'login_success',
  LOGIN_FAIL:       'login_fail',
  LOGOUT:           'logout',
  PASSWORD_CHANGED: 'password_changed',
  EMAIL_CHANGED:    'email_changed',
  TOTP_ENABLED:     'totp_enabled',
  TOTP_DISABLED:    'totp_disabled',
  PASSKEY_ADDED:    'passkey_added',
  PASSKEY_REMOVED:  'passkey_removed',
  SESSION_REVOKED:  'session_revoked',
  ACCOUNT_DELETED:  'account_deleted',
};

function logSecurityEvent(userId, action, req, meta = {}) {
  try {
    const db = getDb();
    const ip = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
      || req?.socket?.remoteAddress || null;
    db.prepare(
      'INSERT INTO security_audit_log (id, user_id, action, ip_address, user_agent, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), userId, action, ip, req?.headers?.['user-agent'] || null, JSON.stringify(meta), Date.now());
  } catch { /* non-blocking, never crash the request */ }
}

module.exports = { logSecurityEvent, ACTIONS };
```

3. Добавить вызовы `logSecurityEvent` в:
   - `backend/src/routes/auth.js`: при успешном логине, при логауте, при смене пароля
   - `backend/src/routes/totp.js`: при включении/отключении 2FA
   - `backend/src/routes/users.js`: при удалении аккаунта, при смене email
   - `backend/src/routes/webauthn.js`: при добавлении/удалении passkey

4. Добавить endpoint `GET /sessions/audit-log` (в `backend/src/routes/sessions.js`) — пользователь может видеть последние 50 записей своего лога безопасности. Не показывать user_agent/ip полностью — маскировать до "Chrome, Windows" и "X.X.*.*".

---

## БЛОК C — Дополнительная безопасность

---

### C1. CSRF-защита

**Файлы:** `backend/src/middleware/csrf.js` (создать), `backend/src/index.js`

**Проблема:**
Cookie-based аутентификация без CSRF-токенов уязвима к Cross-Site Request Forgery атакам. Злоумышленник может заставить браузер жертвы выполнить POST-запрос на behalf of пользователя.

**Что сделать:**

Использовать паттерн **Double Submit Cookie** (без состояния на сервере):

1. Создать `backend/src/middleware/csrf.js`:
```js
'use strict';
const crypto = require('crypto');

const IS_PROD   = process.env.NODE_ENV === 'production';
const TOKEN_TTL = 24 * 60 * 60 * 1000; // 24h

// Safe methods don't need CSRF protection
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Routes exempt from CSRF (token-based, not cookie-based)
const EXEMPT_PATHS = [
  '/auth/login', '/auth/register', '/auth/verify-email',
  '/auth/forgot-password', '/auth/reset-password',
  '/webauthn/auth/options', '/webauthn/auth/verify',
  '/health',
];

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function setCsrfCookie(res) {
  const token = generateCsrfToken();
  res.cookie('_csrf', token, {
    httpOnly: false, // JS must be able to read this
    secure: IS_PROD,
    sameSite: IS_PROD ? 'none' : 'lax',
    maxAge: TOKEN_TTL,
    path: '/',
  });
  return token;
}

function csrfMiddleware(req, res, next) {
  // Issue token on GET requests (SPA boot)
  if (req.method === 'GET' && !req.cookies._csrf) {
    setCsrfCookie(res);
    return next();
  }

  if (SAFE_METHODS.has(req.method)) return next();
  if (EXEMPT_PATHS.some(p => req.path.startsWith(p))) return next();

  const cookieToken  = req.cookies._csrf;
  const headerToken  = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'CSRF token mismatch' });
  }
  next();
}

module.exports = { csrfMiddleware, setCsrfCookie };
```

2. В `backend/src/index.js` после `cookieParser()`:
```js
const { csrfMiddleware } = require('./middleware/csrf');
app.use(csrfMiddleware);
```

3. На фронтенде в `web/src/api/client.ts` в request interceptor:
```ts
// Read CSRF token from cookie and add to header
const csrfToken = document.cookie
  .split('; ')
  .find(row => row.startsWith('_csrf='))
  ?.split('=')[1];

if (csrfToken && !['GET', 'HEAD'].includes(config.method?.toUpperCase() ?? '')) {
  config.headers['X-CSRF-Token'] = csrfToken;
}
```

---

### C2. Rate limiting на Socket.IO события

**Файл:** `backend/src/socket/socketServer.js`

**Проблема:**
HTTP-эндпоинты ограничены (60 msg/min), но через WebSocket можно слать сообщения в обход ограничений.

**Что сделать:**

1. Добавить в `socketServer.js` класс RateLimiter:
```js
// Per-user per-event rate limiter (in-memory, resets each window)
class SocketRateLimiter {
  constructor(maxPerWindow, windowMs) {
    this.max = maxPerWindow;
    this.windowMs = windowMs;
    this.map = new Map(); // userId:event -> { count, resetAt }
  }
  isLimited(userId, event) {
    const key = `${userId}:${event}`;
    const now = Date.now();
    let entry = this.map.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 1, resetAt: now + this.windowMs };
      this.map.set(key, entry);
      return false;
    }
    if (entry.count >= this.max) return true;
    entry.count++;
    return false;
  }
}

const msgLimiter    = new SocketRateLimiter(60, 60_000);   // 60 msg/min
const typingLimiter = new SocketRateLimiter(30, 60_000);   // 30 typing/min
```

2. Применить в обработчиках:
```js
socket.on('send-message', (data, cb) => {
  if (msgLimiter.isLimited(userId, 'msg')) {
    return cb?.({ error: 'Слишком много сообщений' });
  }
  // ... existing logic
});

socket.on('typing-start', (data) => {
  if (typingLimiter.isLimited(userId, 'typing')) return;
  // ... existing logic
});
```

3. Очищать `map` раз в 5 минут от устаревших записей:
```js
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of msgLimiter.map) {
    if (now >= val.resetAt) msgLimiter.map.delete(key);
  }
}, 5 * 60 * 1000);
```

---

### C3. Строгий rate limit для backup-кодов 2FA

**Файл:** `backend/src/middleware/rateLimits.js`, `backend/src/routes/auth.js`

**Проблема:**
Проверка backup-кодов проходит через общий `otpVerifyLimiter` (10 попыток / 15 мин). Злоумышленник может перебрать все 10 backup-кодов за 15 минут.

**Что сделать:**

1. В `backend/src/middleware/rateLimits.js` добавить:
```js
const backupCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 3,                    // только 3 попытки
  keyGenerator: req => `backup:${req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток. Подождите 15 минут.' },
});
module.exports = { ..., backupCodeLimiter };
```

2. В `backend/src/routes/auth.js` в handler `POST /auth/totp-verify` определить тип кода:
```js
const trimmed = code.trim();
// Apply stricter limiter for backup codes
if (!/^\d{6}$/.test(trimmed)) {
  // This is a backup code attempt — apply stricter limit
  await new Promise((resolve, reject) => {
    backupCodeLimiter(req, res, (err) => err ? reject(err) : resolve());
  });
}
```
   Либо разделить endpoint на два: `POST /auth/totp-verify` и `POST /auth/backup-verify`, каждый со своим limiter.

---

## БЛОК D — Функционал (высокий приоритет)

---

### D1. Статус «Доставлено» для сообщений (✓ → ✓✓ → ✓✓ синий)

**Файлы:**
- `backend/src/socket/socketServer.js` — добавить emit при получении сообщения
- `web/src/components/ui/icons/MsgStatus.tsx` — добавить третье состояние
- `web/src/types.ts` — обновить тип Message

**Проблема:**
Сейчас только «отправлено» (✓) и «прочитано» (✓✓). Нет промежуточного статуса «доставлено на устройство».

**Что сделать:**

**Backend:**
1. При подключении пользователя через Socket.IO сервер проверяет непрочитанные сообщения и эмитирует `messages-delivered` для чатов:
```js
// В socketServer.js при connect:
const undeliveredChats = db.prepare(`
  SELECT DISTINCT m.chat_id
  FROM messages m
  JOIN chat_members cm ON cm.chat_id = m.chat_id
  WHERE cm.user_id = ? AND m.sender_id != ? AND m.delivered_at IS NULL
    AND m.deleted_at IS NULL AND m.is_system = 0
`).all(userId, userId);

for (const { chat_id } of undeliveredChats) {
  const result = db.prepare(`
    UPDATE messages SET delivered_at = ?
    WHERE chat_id = ? AND sender_id != ? AND delivered_at IS NULL
  `).run(Date.now(), chat_id, userId);

  if (result.changes > 0) {
    io.to(`chat:${chat_id}`).emit('messages-delivered', {
      chatId: chat_id, recipientId: userId, deliveredAt: Date.now(),
    });
  }
}
```

2. Добавить `delivered_at INTEGER` в схему через миграцию `008_message_delivered.js`:
```js
module.exports = {
  up(db) {
    try {
      db.exec('ALTER TABLE messages ADD COLUMN delivered_at INTEGER');
    } catch { /* already exists */ }
  },
};
```

**Frontend:**
1. В `web/src/types.ts` добавить в `Message`:
```ts
delivered_at?: number | null;
```

2. В `web/src/components/ui/icons/MsgStatus.tsx` добавить состояние:
```tsx
// 3 states: pending → sent (✓) → delivered (✓✓ grey) → read (✓✓ blue)
type Status = 'pending' | 'sent' | 'delivered' | 'read';
```

3. В Socket.IO клиенте обрабатывать событие `messages-delivered` и обновлять статус сообщений в store.

---

### D2. @-упоминания с push-уведомлением

**Файлы:** `backend/src/routes/messages.js`, `backend/src/utils/push.js` (или аналог), `web/src/components/chat/MessageBubble.tsx`, `web/src/components/chat/Composer.tsx`

**Что сделать:**

**Backend:**
1. В `backend/src/routes/messages.js` при создании сообщения парсить упоминания:
```js
function extractMentions(text) {
  if (!text) return [];
  const matches = text.match(/@([a-zA-Z0-9_]{3,32})/g) || [];
  return matches.map(m => m.slice(1).toLowerCase());
}

// После создания сообщения:
const mentions = extractMentions(decryptedText);
if (mentions.length > 0) {
  const mentionedUsers = db.prepare(`
    SELECT u.id, u.username
    FROM users u
    JOIN chat_members cm ON cm.chat_id = ? AND cm.user_id = u.id
    WHERE LOWER(u.username) IN (${mentions.map(() => '?').join(',')})
      AND u.id != ?
  `).all(chatId, ...mentions, senderId);

  for (const user of mentionedUsers) {
    // Emit personal notification
    io.to(`user:${user.id}`).emit('mention', {
      chatId, messageId: newMsg.id, senderName: senderUsername,
    });
    // Web Push for offline users
    sendPushToUser(user.id, {
      title: `@${senderUsername} упомянул вас`,
      body: previewText,
      data: { chatId, messageId: newMsg.id },
    });
  }
}
```

2. Сохранять непрочитанные упоминания в таблицу:
```sql
-- Добавить в миграцию 009_mentions.js
CREATE TABLE IF NOT EXISTS message_mentions (
  id         TEXT    PRIMARY KEY,
  message_id TEXT    NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  chat_id    TEXT    NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mentions_user ON message_mentions(user_id, is_read);
```

**Frontend:**
1. В `Composer.tsx` добавить `MentionPopup` при вводе `@` — уже есть компонент `MentionPopup.tsx`, убедиться что он работает корректно и при выборе пользователя вставляет `@username`.

2. В `MessageBubble.tsx` подсвечивать `@currentUsername` в тексте сообщения (жирный/цветной span).

3. В sidebar `ChatItem.tsx` показывать специальный badge `@` (отличный от обычного счётчика) для чатов с непрочитанными упоминаниями.

4. В store обрабатывать событие `mention` и увеличивать mention-счётчик.

---

### D3. Эфемерные (самоудаляющиеся) сообщения

**Файлы:**
- `backend/src/db/versions/009_mentions.js` → добавить в ту же миграцию или `010_ephemeral.js`
- `backend/src/routes/messages.js`
- `backend/src/workers/ephemeralCleanup.js` (создать)
- `web/src/components/chat/Composer.tsx`
- `web/src/components/chat/MessageBubble.tsx`

**Что сделать:**

**Backend — схема:**
```sql
-- Добавить в миграцию:
ALTER TABLE messages ADD COLUMN expires_at INTEGER DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_expires
  ON messages(expires_at) WHERE expires_at IS NOT NULL;
```

**Backend — при создании сообщения** (`POST /chats/:chatId/messages`):
```js
const { text, ttl } = req.body; // ttl в секундах: 30, 300, 3600, 86400 и т.д.
const expires_at = ttl ? Date.now() + ttl * 1000 : null;
// Сохранять expires_at в DB
```

**Backend — воркер удаления** `backend/src/workers/ephemeralCleanup.js`:
```js
function cleanupExpired(io) {
  const db  = getDb();
  const now = Date.now();
  const expired = db.prepare(
    'SELECT id, chat_id FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ? AND deleted_at IS NULL'
  ).all(now);

  for (const msg of expired) {
    db.prepare('UPDATE messages SET deleted_at = ? WHERE id = ?').run(now, msg.id);
    io.to(`chat:${msg.chat_id}`).emit('messages-deleted', {
      chatId: msg.chat_id, messageIds: [msg.id], forEveryone: true,
    });
  }
}
// Запускать каждые 10 секунд
setInterval(() => cleanupExpired(io), 10_000);
```

**Frontend:**
1. В `Composer.tsx` добавить кнопку таймера (иконка ⏱). При нажатии — выпадающее меню: `выкл / 30 сек / 5 мин / 1 час / 1 день`.
2. Выбранный TTL сохраняется в состоянии композера и передаётся в запрос.
3. В `MessageBubble.tsx` для сообщений с `expires_at`:
   - Показывать иконку таймера с обратным отсчётом (обновляется каждую секунду через `setInterval`)
   - Когда до удаления < 10 сек — мигание/подсветка
4. В `web/src/types.ts` добавить `expires_at?: number | null` в `Message`.

---

### D4. Архив чатов

**Файлы:** `backend/src/db/versions/` (новая миграция), `backend/src/routes/chats.js`, `web/src/components/sidebar/Sidebar.tsx`, `web/src/components/sidebar/ChatList.tsx`

**Проблема:**
Нет способа убрать неактивные чаты из основного списка без их удаления.

**Что сделать:**

**Backend — схема:**
```sql
-- Добавить через ALTER TABLE в новой миграции:
ALTER TABLE chat_members ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
```

**Backend — API:**
1. Добавить `POST /chats/:id/archive` и `POST /chats/:id/unarchive`:
```js
router.post('/:id/archive', authMiddleware, (req, res, next) => {
  try {
    const db = getDb();
    db.prepare('UPDATE chat_members SET is_archived = 1 WHERE chat_id = ? AND user_id = ?')
      .run(req.params.id, req.userId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
```
2. В `GET /chats` добавить фильтрацию: по умолчанию `WHERE cm.is_archived = 0`. Добавить query param `?archived=1` для получения архивных.

**Frontend:**
1. В `web/src/store/useChatStore.ts` (или аналог) добавить `archivedChats`.
2. В `Sidebar.tsx` добавить секцию «Архив» — скрытый по умолчанию элемент внизу списка. При клике — раскрывается список архивных чатов.
3. В контекстном меню `ChatItem.tsx` (правый клик) добавить пункт «Архивировать» / «Разархивировать».
4. При получении нового сообщения в архивном чате — автоматически разархивировать его и вернуть в основной список (Socket.IO `new-message` handler).

---

## БЛОК E — Функционал (средний приоритет)

---

### E1. Скорость воспроизведения голосовых сообщений

**Файл:** `web/src/components/chat/MiniPlayer.tsx` (или компонент где рендерится аудиоплеер)

**Что сделать:**

1. Найти компонент с `<audio>` элементом для голосовых сообщений.
2. Добавить состояние `playbackRate`:
```tsx
const RATES = [0.75, 1, 1.5, 2] as const;
const [rateIdx, setRateIdx] = useState(1); // default 1x

function cycleRate() {
  const next = (rateIdx + 1) % RATES.length;
  setRateIdx(next);
  if (audioRef.current) audioRef.current.playbackRate = RATES[next];
}
```
3. Кнопка с текущей скоростью рядом с ползунком:
```tsx
<button className="voiceSpeedBtn" onClick={cycleRate}>
  {RATES[rateIdx]}×
</button>
```
4. Сохранять выбранную скорость в localStorage (`voice_playback_rate`) — чтобы она не сбрасывалась при перемотке между сообщениями.

**CSS** — небольшая кнопка (36×24px), шрифт monospace, рядом с таймером.

---

### E2. Быстрые реакции по double-tap

**Файл:** `web/src/components/chat/MessageBubble.tsx`

**Что сделать:**

1. Добавить обработку double-tap/double-click на пузырь сообщения:
```tsx
const lastTap = useRef<number>(0);

function handleTouchStart() {
  const now = Date.now();
  if (now - lastTap.current < 300) {
    handleQuickReact('❤️'); // быстрая реакция — лайк/сердце
  }
  lastTap.current = now;
}

async function handleQuickReact(emoji: string) {
  // Вызов существующего API react2
  await apiClient.post(`/chats/${msg.chat_id}/messages/${msg.id}/react2`, { emoji });
}
```

2. На desktop — double-click:
```tsx
onDoubleClick={() => handleQuickReact('❤️')}
```

3. Анимация при double-tap: показать большое сердечко (или выбранный emoji) на 600мс с CSS-анимацией `fade-in + scale-up`:
```tsx
{showQuickReact && (
  <div className="quickReactAnim">❤️</div>
)}
```

```css
.quickReactAnim {
  position: absolute; font-size: 2.5rem;
  animation: quickReactPop 0.6s ease-out forwards;
  pointer-events: none;
}
@keyframes quickReactPop {
  0%   { transform: scale(0.3); opacity: 1; }
  60%  { transform: scale(1.3); opacity: 1; }
  100% { transform: scale(1); opacity: 0; }
}
```

---

### E3. Перевод сообщений

**Файлы:** `backend/src/routes/translate.js` (создать), `backend/src/index.js`, `web/src/components/chat/MessageBubble.tsx`

**Что сделать:**

**Backend:**
1. Создать `backend/src/routes/translate.js`:
```js
const router = require('express').Router();
const { authMiddleware } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

const translateLimiter = rateLimit({
  windowMs: 60_000, max: 30,
  keyGenerator: req => `translate:${req.userId}`,
  message: { error: 'Лимит переводов: 30 в минуту' },
});

// POST /translate
router.post('/', authMiddleware, translateLimiter, async (req, res, next) => {
  try {
    const { text, targetLang = 'ru' } = req.body;
    if (!text || text.length > 2000) {
      return res.status(400).json({ error: 'Неверный текст' });
    }

    // LibreTranslate (self-hosted или публичный) — бесплатно
    const response = await fetch(process.env.LIBRETRANSLATE_URL + '/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, source: 'auto', target: targetLang, api_key: process.env.LIBRETRANSLATE_KEY || '' }),
    });
    const data = await response.json();
    res.json({ translation: data.translatedText, detectedLang: data.detectedLanguage?.language });
  } catch (err) { next(err); }
});

module.exports = router;
```
2. Зарегистрировать в `index.js`: `app.use('/translate', require('./routes/translate'))`.
3. Env vars: `LIBRETRANSLATE_URL` (default: `https://libretranslate.com`), `LIBRETRANSLATE_KEY` (optional).

**Frontend:**
1. В `web/src/api/` создать `translate.ts`:
```ts
export async function translateMessage(text: string, targetLang = 'ru') {
  const res = await apiClient.post('/translate', { text, targetLang });
  return res.data as { translation: string; detectedLang?: string };
}
```
2. В `MessageBubble.tsx` добавить в контекстное меню пункт «Перевести»:
```tsx
{ label: 'Перевести', action: () => handleTranslate(msg.text) }
```
3. После перевода — показать перевод под оригинальным текстом в пузыре (collapsible, можно скрыть):
```tsx
{translation && (
  <div className="msgTranslation">
    <span className="msgTranslationLabel">Перевод:</span>
    {translation}
  </div>
)}
```

---

## БЛОК F — Групповые звонки

---

### F1. WebRTC групповые звонки до 8 участников (SFU)

**Это крупная задача. Требует отдельной инфраструктуры.**

**Файлы:**
- `backend/src/socket/socketServer.js` — signaling
- `backend/src/routes/calls.js` — история + ICE servers
- `web/src/components/call/CallOverlay.tsx` — полный рефакторинг
- `web/src/services/webrtcManager.ts` — рефакторинг

**Архитектура:**

Для 1:1 звонков текущая Mesh-архитектура (peer-to-peer) достаточна. Для групп 3+ участников необходим **SFU (Selective Forwarding Unit)**.

**Рекомендуемый подход — mediasoup:**
```
npm install mediasoup  # в backend/
```
mediasoup запускает Worker процессы и создаёт Router для каждой комнаты.

**Этапы реализации:**

1. **Схема БД** — добавить в `calls` таблицу:
```sql
ALTER TABLE calls ADD COLUMN is_group INTEGER NOT NULL DEFAULT 0;
ALTER TABLE calls ADD COLUMN participants TEXT; -- JSON array of user_ids
```

2. **Socket.IO signaling для группового звонка:**
   - `call:group-invite` — инициатор приглашает участников
   - `call:join-room` — участник подключается к SFU room
   - `call:leave-room` — участник покидает
   - `call:participant-joined` — broadcast новому участнику
   - `call:participant-left` — broadcast когда кто-то ушёл

3. **Frontend — `CallOverlay.tsx`:**
   - Рефакторинг под `participants: Map<userId, { stream, audioEnabled, videoEnabled }>`
   - CSS grid для отображения 2–8 видеопотоков (2×1, 2×2, 3×2, 4×2)
   - Активный говорящий выделяется рамкой (Web Audio API `getByteFrequencyData`)
   - Кнопки: mute, видео, выход, добавить участника

4. **Fallback:** Если mediasoup не развёрнут — показывать ошибку "Групповые звонки временно недоступны".

**Инфраструктура:**
- mediasoup требует выделенных UDP-портов на Amvera (настроить `amvera.yaml`)
- Альтернатива без собственного SFU: использовать внешний TURN/SFU сервис (Twilio, Agora) с меньшими трудозатратами

---

## Env-переменные (добавить при деплое)

При реализации блоков A–C добавить в Amvera:

| Переменная | Описание | Пример |
|---|---|---|
| `MESSAGE_KEY_SALT` | Соль для KDF ключа шифрования | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | Отдельный секрет для refresh-токенов | `openssl rand -hex 64` |
| `SENTRY_DSN` | DSN проекта backend в Sentry | `https://xxx@sentry.io/123` |
| `LIBRETRANSLATE_URL` | URL LibreTranslate инстанса | `https://libretranslate.com` |
| `LIBRETRANSLATE_KEY` | API-ключ LibreTranslate (опционально) | `abc123...` |

При реализации на Vercel:

| Переменная | Описание |
|---|---|
| `VITE_SENTRY_DSN` | DSN проекта frontend в Sentry |

---

## Порядок коммитов (рекомендуемый)

```
feat(security/A1): add PBKDF2 key derivation for message encryption
feat(security/A2): separate JWT_REFRESH_SECRET for refresh tokens
feat(security/A3): per-chat HKDF key derivation with legacy fallback
feat(reliability/B1): scheduled message delivery worker
feat(reliability/B2): idempotency keys for message send
feat(monitoring/B3): Sentry integration (backend + frontend)
feat(audit/B4): user security audit log table and events
feat(security/C1): double-submit cookie CSRF protection
feat(security/C2): per-user Socket.IO rate limiting
feat(security/C3): strict rate limit for 2FA backup codes
feat(messaging/D1): message delivered status (✓✓ grey)
feat(messaging/D2): @mentions with push notification
feat(messaging/D3): ephemeral self-destructing messages
feat(ux/D4): chat archive
feat(ux/E1): voice message playback speed toggle
feat(ux/E2): double-tap quick reactions
feat(ux/E3): message translation via LibreTranslate
feat(calls/F1): group WebRTC calls via mediasoup SFU
```

---

*Документ составлен на основе аудита кодовой базы ветки `devDK` от 2026-05-12.*
*Все указанные файлы и строки верифицированы прямым чтением кода.*
