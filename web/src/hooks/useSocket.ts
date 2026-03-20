/**
 * useSocket
 *
 * Manages the Socket.io connection lifecycle and routes all incoming events
 * to the appropriate store actions.
 * Must be called once at the top of the component tree (App.tsx).
 */

import { useEffect } from 'react';
import { type Chat, type Message } from '../types';
import { connectSocket, disconnectSocket, getSocket } from '../socket/socketClient';
import { markChatRead as apiMarkChatRead } from '../api/chats';
import { useSessionStore } from '../store/useSessionStore';
import { useChatsStore } from '../store/useChatsStore';

let _markReadTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleMarkRead(chatId: string) {
  if (_markReadTimer) clearTimeout(_markReadTimer);
  _markReadTimer = setTimeout(async () => {
    try {
      await apiMarkChatRead(chatId);
      useChatsStore.getState().markChatRead(chatId);
    } catch { /* ignore */ }
  }, 300);
}

export function useSocket() {
  const token = useSessionStore(s => s.token);

  useEffect(() => {
    if (!token) return;
    connectSocket(token);
    const socket = getSocket();
    if (!socket) return;

    const onNewMessage = (msg: Message) => {
      const { activeChatId, chats, loadChats, handleNewMessage } = useChatsStore.getState();
      const isActive = msg.chat_id === activeChatId;
      if (!chats.some(c => c.id === msg.chat_id)) { loadChats(); return; }
      handleNewMessage(msg);
      if (isActive) scheduleMarkRead(msg.chat_id);
    };

    const onChatRead = ({ chatId, userId, readAt }: { chatId: string; userId: string; readAt: number }) => {
      const meId = useSessionStore.getState().me?.id ?? '';
      useChatsStore.getState().handleChatRead(chatId, userId, readAt, meId);
    };

    const onMessagesDeleted = ({ chatId, messageIds }: { chatId: string; messageIds: string[] }) => {
      useChatsStore.getState().handleMessagesDeleted(chatId, messageIds);
    };

    const onChatCreated = (chat: Chat) => useChatsStore.getState().upsertChat(chat);
    const onChatUpdated = (chat: Chat) => useChatsStore.getState().upsertChat(chat);
    const onChatRemoved = ({ chatId }: { chatId: string }) => useChatsStore.getState().removeChat(chatId);
    const onAccountDeleted = () => useSessionStore.getState().clearSession();

    socket.on('new-message', onNewMessage);
    socket.on('chat-read', onChatRead);
    socket.on('messages-deleted', onMessagesDeleted);
    socket.on('chat-created', onChatCreated);
    socket.on('chat-updated', onChatUpdated);
    socket.on('chat-removed', onChatRemoved);
    socket.on('account-deleted', onAccountDeleted);

    return () => {
      socket.off('new-message', onNewMessage);
      socket.off('chat-read', onChatRead);
      socket.off('messages-deleted', onMessagesDeleted);
      socket.off('chat-created', onChatCreated);
      socket.off('chat-updated', onChatUpdated);
      socket.off('chat-removed', onChatRemoved);
      socket.off('account-deleted', onAccountDeleted);
      if (_markReadTimer) clearTimeout(_markReadTimer);
      disconnectSocket();
    };
  }, [token]); // eslint-disable-line
}
