/**
 * useSocket
 * ✅ Added: message-pinned / message-unpinned socket events.
 */
import { useEffect } from 'react';
import { type Chat, type Message } from '../types';
import { connectSocket, disconnectSocket, getSocket } from '../socket/socketClient';
import { markChatRead as apiMarkChatRead } from '../api/chats';
import { useSessionStore } from '../store/useSessionStore';
import { useChatsStore } from '../store/useChatsStore';
import { registerPush } from '../utils/push';

let _markReadTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingReadUntil: number | undefined = undefined;
let _pendingChatId: string | null = null;

export function scheduleMarkRead(chatId: string, readUntil?: number) {
  // Don't move read position backwards
  if (readUntil !== undefined && _pendingChatId === chatId &&
      _pendingReadUntil !== undefined && readUntil <= _pendingReadUntil) return;

  if (_markReadTimer) clearTimeout(_markReadTimer);
  _pendingChatId  = chatId;
  _pendingReadUntil = readUntil;

  _markReadTimer = setTimeout(async () => {
    _markReadTimer = null;
    try {
      await apiMarkChatRead(chatId, _pendingReadUntil);
    } catch { /* ignore */ }
  }, 400);
}

export function useSocket() {
  const token = useSessionStore(s => s.token);

  useEffect(() => {
    if (!token) return;
    connectSocket(token);
    const socket = getSocket();
    if (!socket) return;

    // Register for Web Push notifications after a short delay so the app
    // fully renders first and the permission dialog appears in context.
    const pushTimer = setTimeout(() => { registerPush(); }, 5000);

    const onNewMessage = (msg: Message) => {
      const { chats, loadChats, handleNewMessage } = useChatsStore.getState();
      if (!chats.some(c => c.id === msg.chat_id)) { loadChats(); return; }
      handleNewMessage(msg);
      // Read tracking is handled by MessageList scroll observer — no auto-mark here
    };

    const onChatRead = ({ chatId, userId, readAt }: { chatId: string; userId: string; readAt: number }) => {
      const meId = useSessionStore.getState().me?.id ?? '';
      useChatsStore.getState().handleChatRead(chatId, userId, readAt, meId);
    };

    const onMessagesDeleted = ({ chatId, messageIds }: { chatId: string; messageIds: string[] }) => {
      useChatsStore.getState().handleMessagesDeleted(chatId, messageIds);
    };

    const onChatCreated  = (chat: Chat) => useChatsStore.getState().upsertChat(chat);
    const onChatUpdated  = (chat: Chat) => useChatsStore.getState().upsertChat(chat);
    const onChatRemoved  = ({ chatId }: { chatId: string }) => useChatsStore.getState().removeChat(chatId);
    const onAccountDeleted = () => useSessionStore.getState().clearSession();

    // ✅ NEW: pin/unpin events — update is_pinned flag on the message in the store
    const onMessagePinned = ({ chatId, message }: { chatId: string; message: Message }) => {
      const state = useChatsStore.getState();
      if (state.activeChatId === chatId) {
        state.setMessages(state.messages.map(m => m.id === message.id ? { ...m, is_pinned: true } : m));
      }
    };

    const onMessageUnpinned = ({ chatId, messageId }: { chatId: string; messageId: string }) => {
      const state = useChatsStore.getState();
      if (state.activeChatId === chatId) {
        state.setMessages(state.messages.map(m => m.id === messageId ? { ...m, is_pinned: false } : m));
      }
    };

    // ✅ NEW: online presence events
    const onUserOnline = ({ userId }: { userId: string }) => {
      useChatsStore.getState().setUserOnline(userId);
    };

    const onUserOffline = ({ userId, last_seen_at }: { userId: string; last_seen_at?: number }) => {
      useChatsStore.getState().setUserOffline(userId, last_seen_at);
    };

    // ✅ NEW: poll vote updates
    const onPollUpdated = ({ messageId, poll }: { messageId: string; poll: import('../types').Poll }) => {
      useChatsStore.getState().updateMessagePoll(messageId, poll);
    };

    // ✅ NEW: typing indicators
    const onUserTyping = ({ userId, chatId }: { userId: string; chatId: string }) => {
      useChatsStore.getState().setTyping(chatId, userId, true);
    };
    const onUserStoppedTyping = ({ userId, chatId }: { userId: string; chatId: string }) => {
      useChatsStore.getState().setTyping(chatId, userId, false);
    };

    // ✅ NEW: emoji reactions
    const onMessageReactionV2 = ({
      messageId, chatId, reactions,
    }: { messageId: string; chatId: string; reactions: Array<{ userId: string; emoji: string }> }) => {
      const state = useChatsStore.getState();
      if (state.activeChatId === chatId) {
        state.setMessages(state.messages.map(m =>
          m.id === messageId ? { ...m, reactions } : m
        ));
      }
    };

    // ✅ NEW: session revoked — log out if it's our session
    const onSessionRevoked = ({ sessionId }: { sessionId: string }) => {
      const { token } = useSessionStore.getState();
      if (!token) return;
      try {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload?.jti === sessionId) useSessionStore.getState().clearSession();
      } catch { /* ignore malformed token */ }
    };

    const onMessageEdited = (msg: Message) => {
      const state = useChatsStore.getState();
      if (state.activeChatId === msg.chat_id) {
        state.setMessages(state.messages.map(m => m.id === msg.id ? msg : m));
      }
      // Also update last_message in chat list if it matches
      state.chats.forEach(c => {
        if (c.last_message?.id === msg.id) {
          state.upsertChat({ ...c, last_message: msg });
        }
      });
    };

    socket.on('new-message',          onNewMessage);
    socket.on('chat-read',            onChatRead);
    socket.on('messages-deleted',     onMessagesDeleted);
    socket.on('chat-created',         onChatCreated);
    socket.on('chat-updated',         onChatUpdated);
    socket.on('chat-removed',         onChatRemoved);
    socket.on('account-deleted',      onAccountDeleted);
    socket.on('message-pinned',       onMessagePinned);       // ✅
    socket.on('message-unpinned',     onMessageUnpinned);     // ✅
    socket.on('user-online',          onUserOnline);          // ✅
    socket.on('user-offline',         onUserOffline);         // ✅
    socket.on('message-reaction-v2',  onMessageReactionV2);   // ✅
    socket.on('message-edited',        onMessageEdited);         // ✅
    socket.on('session-revoked',       onSessionRevoked);        // ✅
    socket.on('poll-updated',         onPollUpdated);           // ✅
    socket.on('user-typing',          onUserTyping);            // ✅
    socket.on('user-stopped-typing',  onUserStoppedTyping);     // ✅

    return () => {
      socket.off('new-message',          onNewMessage);
      socket.off('chat-read',            onChatRead);
      socket.off('messages-deleted',     onMessagesDeleted);
      socket.off('chat-created',         onChatCreated);
      socket.off('chat-updated',         onChatUpdated);
      socket.off('chat-removed',         onChatRemoved);
      socket.off('account-deleted',      onAccountDeleted);
      socket.off('message-pinned',       onMessagePinned);
      socket.off('message-unpinned',     onMessageUnpinned);
      socket.off('user-online',          onUserOnline);
      socket.off('user-offline',         onUserOffline);
      socket.off('message-reaction-v2',  onMessageReactionV2);
      socket.off('message-edited',        onMessageEdited);
      socket.off('session-revoked',       onSessionRevoked);
      socket.off('poll-updated',         onPollUpdated);
      socket.off('user-typing',          onUserTyping);
      socket.off('user-stopped-typing',  onUserStoppedTyping);
      clearTimeout(pushTimer);
      if (_markReadTimer) clearTimeout(_markReadTimer);
      disconnectSocket();
    };
  }, [token]); // eslint-disable-line
}
