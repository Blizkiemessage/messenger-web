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
import { isAuthError } from '../api/errors';
import i18n from '../i18n';

export function useMessages() {
  const me = useSessionStore(s => s.me);
  const activeChatId = useChatsStore(s => s.activeChatId);

  // Load messages when active chat changes
  useEffect(() => {
    if (!me || !activeChatId) {
      useChatsStore.getState().setMessages([]);
      return;
    }
    useChatsStore.getState().setLoadingMessages(true);
    useChatsStore.getState().setDataError(null);
    joinChat(activeChatId);
    setActiveChat(activeChatId);

    getChatMessages(activeChatId)
      .then(msgs => {
        useChatsStore.getState().setMessages(msgs);
        // Read marking is driven by scroll position in MessageList — not auto-marked here
      })
      .catch((e: any) => {
        // `dataError` is rendered by the chat LIST (Sidebar → ChatList), so a
        // raw server string from a message load used to end up there verbatim —
        // e.g. the untranslated «Forbidden» seen during the QA run 2026-09-03,
        // which stayed on screen until a manual reload. Auth errors here are
        // transient (token refresh in flight right after a logout→login), and
        // the effect re-runs on the next chat switch / socket reconnect, so
        // stay quiet — same rule loadChats already applies.
        if (isAuthError(e)) return;
        useChatsStore.getState().setDataError(e?.message ?? i18n.t('common:errorGeneric'));
      })
      .finally(() => useChatsStore.getState().setLoadingMessages(false));


    return () => { setActiveChat(null); };
  }, [me, activeChatId]); // eslint-disable-line

  const sendMessage = useCallback(async (text: string) => {
    const chatId = useChatsStore.getState().activeChatId;
    if (!chatId || !text.trim()) return;
    try {
      await sendChatMessage(chatId, { text: text.trim() });
    } catch (e: any) {
      useChatsStore.getState().setDataError(e?.message ?? i18n.t('common:errorGeneric'));
    }
  }, []);

  const deleteSelected = useCallback(async () => {
    const { activeChatId: chatId, selectedIds } = useChatsStore.getState();
    if (!chatId || selectedIds.size === 0) return;
    const forEveryone = useAppStore.getState().deleteForEveryone;
    useAppStore.getState().setDeleteBusy(true);
    try {
      const deleted = await apiDeleteMessages(chatId, [...selectedIds], forEveryone);
      useChatsStore.getState().removeBulkMessages(chatId, deleted);
      useChatsStore.getState().clearSelection();
      useAppStore.getState().setShowDeleteConfirm(false);
    } catch (e: any) {
      useChatsStore.getState().setDataError(e?.message ?? i18n.t('common:errorGeneric'));
    } finally {
      useAppStore.getState().setDeleteBusy(false);
    }
  }, []);

  const loadOlderMessages = useCallback(async () => {
    const { messages, hasMoreMessages, activeChatId: chatId } = useChatsStore.getState();
    if (!chatId || !hasMoreMessages || messages.length === 0) return;
    const before = messages[0].created_at;
    try {
      const older = await getChatMessages(chatId, before);
      if (older.length > 0) useChatsStore.getState().prependMessages(older);
      useChatsStore.getState().setHasMoreMessages(older.length >= 50);
    } catch { /* ignore */ }
  }, []);

  return { sendMessage, deleteSelected, loadOlderMessages };
}
