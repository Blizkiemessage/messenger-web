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

  // Access-токен живёт 15 минут. Если приложение открыли с протухшим токеном —
  // обновляем его ДО handshake, иначе сервер ответит «Invalid token».
  // refresh дедуплицирован с REST-интерсептором (общий promise в api/client).
  const stored = getToken();
  if (stored && isTokenExpired(stored) && getRefreshToken()) {
    refreshAccessToken().catch(() => {});
    // не ждём: auth ниже — функция, реконнект сам возьмёт свежий токен
  }

  socket = io(SOCKET_URL, {
    withCredentials: true, // still send cookie for same-origin / Safari
    // ВАЖНО: auth как функция — вызывается на КАЖДОЙ попытке подключения
    // (включая авто-реконнекты), поэтому всегда отдаёт свежий токен из
    // localStorage, даже если REST-интерсептор обновил его после создания сокета.
    auth: (cb) => {
      const token = getToken();
      cb(token ? { token } : {});
    },
    transports: ['websocket'],
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
      msg.includes('jwt');
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

  return socket;
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
