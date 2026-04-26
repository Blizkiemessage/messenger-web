import { io, type Socket } from 'socket.io-client';
import { SOCKET_URL } from '../config';

let socket: Socket | null = null;

export function connectSocket(): Socket {
  // Reuse existing socket even if still connecting — creating a second io()
  // while the first handshake is in-flight causes the browser warning
  // "WebSocket is closed before the connection is established".
  if (socket) return socket;

  socket = io(SOCKET_URL, {
    withCredentials: true, // send HttpOnly session cookie on WS handshake
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
