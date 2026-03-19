import { io, type Socket } from 'socket.io-client';
import { SOCKET_URL } from '../config';

let socket: Socket | null = null;

export function connectSocket(token: string): Socket {
  if (socket?.connected) return socket;

  socket = io(SOCKET_URL, {
    auth: { token },
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

