import { io, type Socket } from 'socket.io-client';
import { SOCKET_URL } from '../config';
import { getToken, clearSession } from '../storage/session';

let socket: Socket | null = null;

export function connectSocket(): Socket {
  // Reuse existing socket if it is connected or actively reconnecting.
  // `socket.active` is true while socket.io is in any reconnection cycle;
  // it becomes false only after disconnect() or after exhausting all attempts.
  // Returning a permanently-disconnected socket would leave the app deaf.
  if (socket?.active) return socket;

  // If a previous socket exists but is no longer active (all reconnect
  // attempts exhausted or manually disconnected), tear it down first so we
  // get a clean connection with the freshest token from localStorage.
  if (socket) {
    socket.disconnect();
    socket = null;
  }

  // Pass token via socket.io `auth` so the server can authenticate the WS
  // handshake even when Chrome blocks the HttpOnly session cookie cross-origin.
  const token = getToken();

  socket = io(SOCKET_URL, {
    withCredentials: true, // still send cookie for same-origin / Safari
    auth: token ? { token } : undefined,
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  socket.on('connect', () => {
    // eslint-disable-next-line no-console
    console.log('[Socket] connected', socket?.id);
  });
  socket.on('connect_error', (err: any) => {
    // eslint-disable-next-line no-console
    console.error('[Socket] connect_error', err?.message ?? err);

    // If the server rejected our token, clear the session and redirect to
    // the login screen. A hard reload guarantees a clean app state.
    const msg = String(err?.message ?? '');
    if (
      msg.includes('Invalid token') ||
      msg.includes('Unauthorized') ||
      msg.includes('jwt')
    ) {
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
