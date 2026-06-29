import { io, type Socket } from 'socket.io-client';
import { SOCKET_URL } from '../config';
import { getToken, getRefreshToken, clearSession } from '../storage/session';
import { refreshAccessToken } from '../api/client';

let socket: Socket | null = null;

/** Истёк ли JWT (с запасом 15 секунд), судя по полю exp в payload. */
function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now() + 15_000;
  } catch {
    return false; // непарсибельный токен — пусть решает сервер
  }
}

export function connectSocket(): Socket {
  // Reuse existing socket if it is connected or actively reconnecting.
  // `socket.active` is true while socket.io is in any reconnection cycle;
  // it becomes false only after disconnect() or after exhausting all attempts.
  // Returning a permanently-disconnected socket would leave the app deaf.
  if (socket?.active) return socket;

  // If a previous socket exists but is no longer active, tear it down first
  // so we get a clean connection.
  if (socket) {
    socket.disconnect();
    socket = null;
  }

  socket = io(SOCKET_URL, {
    withCredentials: true, // still send cookie for same-origin / Safari
    // НЕ подключаемся сразу: на холодном старте/после reload access-токен в памяти
    // ещё null, и сокет ушёл бы на handshake без токена → сервер «No token» →
    // соединение цеплялось только через несколько реконнект-циклов («перезагрузи
    // страницу»). Сначала refresh, потом connect (см. блок перед return).
    autoConnect: false,
    // ВАЖНО: auth как функция — вызывается на КАЖДОЙ попытке подключения
    // (включая авто-реконнекты), поэтому всегда отдаёт свежий токен из
    // localStorage, даже если REST-интерсептор обновил его после создания сокета.
    auth: (cb) => {
      const token = getToken();
      cb(token ? { token } : {});
    },
    // websocket first (fast), polling as fallback — a websocket-only client can
    // fail to (re)connect on flaky mobile networks / after a PWA resume, leaving
    // the user silently offline (no presence/typing/calls) until a manual reload.
    transports: ['websocket', 'polling'],
    reconnection: true,
    // Не сдаёмся: холодный старт бэкенда (Amvera) может длиться дольше,
    // чем 10 попыток. Авторизационные ошибки обрабатываются отдельно ниже.
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });

  socket.on('connect', () => {
    // eslint-disable-next-line no-console
    console.log('[Socket] connected', socket?.id);
  });
  socket.on('connect_error', async (err: any) => {
    // eslint-disable-next-line no-console
    console.error('[Socket] connect_error', err?.message ?? err);

    const msg = String(err?.message ?? '');
    const isAuthError =
      msg.includes('Invalid token') ||
      msg.includes('Unauthorized') ||
      msg.includes('jwt') ||
      // На reload access-токен живёт в памяти и пуст; если httpOnly-cookie
      // заблокирована (cross-origin), handshake приходит без токена — обновляем
      // и переподключаемся со свежим токеном.
      msg.includes('No token');
    if (!isAuthError) return; // сетевые ошибки — socket.io сам реконнектится

    // Токен отвергнут сервером: пробуем тихо обновить через refresh-токен.
    // Следующий авто-реконнект возьмёт свежий токен через auth-функцию.
    const fresh = await refreshAccessToken().catch(() => null);
    if (!fresh) {
      // Нет refresh-токена или refresh провалился (там уже был redirect) —
      // чистим сессию и уводим на логин.
      socket?.disconnect();
      socket = null;
      clearSession();
      window.location.href = '/';
    }
  });

  // ── Подключение с валидным токеном ──────────────────────────────────────────
  // На холодном старте/после reload access-токен в памяти ещё null. Тихо обновляем
  // его через refresh-токен и ТОЛЬКО потом connect() — первый же handshake уходит
  // с токеном, без «No token» и ручных перезагрузок. refresh дедуплицирован
  // (общий promise) с REST-интерсептором. Нет refresh-токена → connect сразу
  // (получит «No token» → connect_error выше уведёт на логин).
  const token = getToken();
  if ((!token || isTokenExpired(token)) && getRefreshToken()) {
    refreshAccessToken().catch(() => {}).finally(() => { socket?.connect(); });
  } else {
    socket.connect();
  }

  return socket;
}

/** Полный пересоздать сокет (когда после resume обнаружен мёртвый/зомби-сокет). */
function hardReconnect(): void {
  if (socket) { socket.disconnect(); socket = null; }
  connectSocket();
}

let healthCheckInFlight = false;

/**
 * Гарантировать живой сокет. Вызывается при возвращении приложения на передний
 * план / восстановлении сети (visibilitychange, pageshow, online, focus).
 *
 * Проблема, которую решает: мобильный PWA при сворачивании «замораживается»,
 * TCP-соединение тихо умирает, но socket.io ещё ДУМАЕТ, что подключён
 * (connected === true). До следующего ping-таймаута (десятки секунд) presence/
 * «печатает»/звонки не работают — раньше помогал только reload.
 *
 * Логика:
 *   - нет сокета            → создать;
 *   - есть, но не connected → возобновить переподключение (socket.connect());
 *   - connected === true    → проверить «живость» ack-пингом с коротким таймаутом;
 *                             нет ответа за 3 с → это зомби → пересоздать.
 */
export function ensureSocketHealthy(): void {
  const s = socket;
  if (!s) { connectSocket(); return; }
  if (!s.connected) { s.connect(); return; }

  if (healthCheckInFlight) return;
  healthCheckInFlight = true;
  // socket.io v4: .timeout(ms).emit(ev, ack) → ack получает Error при таймауте.
  s.timeout(3000).emit('client-ping', (err: unknown) => {
    healthCheckInFlight = false;
    if (err) hardReconnect(); // пинг не дошёл → соединение мёртвое
  });
}

export function disconnectSocket(): void {
  if (!socket) return;
  socket.disconnect();
  socket = null;
}

export function getSocket(): Socket | null {
  return socket;
}

export function joinChat(chatId: string): void {
  socket?.emit('join-chat', chatId);
}

export function setActiveChat(chatId: string | null): void {
  socket?.emit('set-active-chat', chatId);
}

export function emitTypingStart(chatId: string): void {
  socket?.emit('typing-start', { chatId });
}

export function emitTypingStop(chatId: string): void {
  socket?.emit('typing-stop', { chatId });
}

// ── E3: Call signaling emitters ───────────────────────────────────────────────

export function emitCallInvite(p: {
  callId: string; calleeId: string; chatId: string; callType: 'audio' | 'video';
}): void {
  socket?.emit('call:invite', p);
}

export function emitCallAccept(callId: string): void {
  socket?.emit('call:accept', { callId });
}

export function emitCallReject(callId: string): void {
  socket?.emit('call:reject', { callId });
}

export function emitCallEnd(callId: string): void {
  socket?.emit('call:end', { callId });
}
