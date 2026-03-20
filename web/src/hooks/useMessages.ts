/**
 * useMessages
 *
 * Loads messages when the active chat changes.
 * All store calls are inside effects/callbacks — never during render.
 */
import { useEffect, useCallback } from 'react';
import { getChatMessages, sendChatMessage, deleteMessages as apiDeleteMessages } from '../api/chats';
import { joinChat, setActiveChat } from '../socket/socketClient';
import { useSessionStore } from '../store/useSessionStore';
import { useChatsStore } from '../store/useChatsStore';
import { useAppStore } from '../store/useAppStore';
import { scheduleMarkRead } from './useSocket';

export function useMessages() {
  const token = useSessionStore(s => s.token);
  const activeChatId = useChatsStore(s => s.activeChatId);

  // Load messages when active chat changes
  useEffect(() => {
    if (!token || !activeChatId) {
      useChatsStore.getState().setMessages([]);
      return;
    }
    useChatsStore.getState().setLoadingMessages(true);
    useChatsStore.getState().setDataError(null);
    joinChat(activeChatId);
    setActiveChat(activeChatId);
    useChatsStore.getState().markChatRead(activeChatId);

    getChatMessages(activeChatId)
      .then(msgs => {
        useChatsStore.getState().setMessages(msgs);
        scheduleMarkRead(activeChatId);
      })
      .catch((e: any) => useChatsStore.getState().setDataError(e?.message ?? 'Ошибка загрузки сообщений'))
      .finally(() => useChatsStore.getState().setLoadingMessages(false));

    return () => { setActiveChat(null); };
  }, [token, activeChatId]); // eslint-disable-line

  const sendMessage = useCallback(async (text: string) => {
    const chatId = useChatsStore.getState().activeChatId;
    if (!chatId || !text.trim()) return;
    try {
      await sendChatMessage(chatId, { text: text.trim() });
    } catch (e: any) {
      useChatsStore.getState().setDataError(e?.message ?? 'Ошибка отправки');
    }
  }, []);

  const deleteSelected = useCallback(async () => {
    const { activeChatId: chatId, selectedIds } = useChatsStore.getState();
    if (!chatId || selectedIds.size === 0) return;
    useAppStore.getState().setDeleteBusy(true);
    try {
      const deleted = await apiDeleteMessages(chatId, [...selectedIds]);
      useChatsStore.getState().removeBulkMessages(chatId, deleted);
      useChatsStore.getState().clearSelection();
      useAppStore.getState().setShowDeleteConfirm(false);
    } catch (e: any) {
      useChatsStore.getState().setDataError(e?.message ?? 'Ошибка удаления');
    } finally {
      useAppStore.getState().setDeleteBusy(false);
    }
  }, []);

  return { sendMessage, deleteSelected };
}
