/**
 * useSocket
 * ✅ Added: message-pinned / message-unpinned socket events.
 */
import { useEffect } from 'react';
import { type Chat, type Message, type User, type SharedNote } from '../types';
import { connectSocket, disconnectSocket, getSocket, ensureSocketHealthy } from '../socket/socketClient';
import { emitCallReject } from '../socket/socketClient';
import { markChatRead as apiMarkChatRead } from '../api/chats';
import { useSessionStore } from '../store/useSessionStore';
import { useChatsStore } from '../store/useChatsStore';
import { useStickerStore } from '../store/useStickerStore';
import { useCallStore } from '../store/useCallStore';
import { webrtcManager } from '../services/webrtcManager';
import { registerPush } from '../utils/push';
import { useNotesStore } from '../store/useNotesStore';

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
  }, 150);
}

export function useSocket() {
  // Select only the user id so that store updates to `me` (e.g. presence,
  // avatar) do NOT re-run this effect and reconnect the socket mid-flight.
  // The socket only needs to reconnect when the logged-in user changes.
  const meId = useSessionStore(s => s.me?.id);

  useEffect(() => {
    if (!meId) return;
    connectSocket();
    const socket = getSocket();
    if (!socket) return;

    // ── Keep the socket alive across mobile-PWA suspend/resume & network changes ──
    // When the app returns to the foreground (or the network comes back), verify
    // the connection is really alive and reconnect if it died while backgrounded.
    // Without this a resumed PWA can sit on a dead "connected" socket — no
    // presence/typing and, critically, missed incoming calls — until a reload.
    const ensureAlive = () => { if (document.visibilityState === 'visible') ensureSocketHealthy(); };
    const onOnline = () => ensureSocketHealthy();
    document.addEventListener('visibilitychange', ensureAlive);
    window.addEventListener('focus', ensureAlive);
    window.addEventListener('pageshow', ensureAlive);
    window.addEventListener('online', onOnline);

    // Register for Web Push notifications after a short delay so the app
    // fully renders first and the permission dialog appears in context.
    const pushTimer = setTimeout(() => { registerPush(); }, 5000);

    // ── Clear stale presence on (re)connect ───────────────────────────────────
    // Socket.IO reconnects silently (network blip, camera permission prompt, etc.).
    // The server re-emits user-online for currently-online contacts after each
    // connection, but never sends user-offline for users who disconnected while
    // we were away. Clearing here prevents stale "Онлайн" badges and stuck typing.
    const onConnect = () => {
      useChatsStore.setState({
        onlineUsers: new Set<string>(),
        typingUsers: new Map<string, string[]>(),
      });
      // Eagerly warm up sticker/emoji cache so packs open instantly
      useStickerStore.getState().fetchInstalledPacks();
      // Перезагружаем список чатов: после долгого сна/оффлайна подписанные
      // S3-ссылки аватарок (TTL 1 час) протухают — свежий fetch их переподписывает.
      useChatsStore.getState().loadChats();
    };
    socket.on('connect', onConnect);

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

    // ✅ session revoked — log out if it's our session
    const onSessionRevoked = ({ sessionId }: { sessionId: string }) => {
      const mySessionId = useSessionStore.getState().sessionId;
      if (mySessionId && sessionId === mySessionId) {
        useSessionStore.getState().clearSession();
      }
    };

    const onBlockStatusChanged = ({ blockerId, blocked }: { blockerId: string; blocked: boolean }) => {
      useChatsStore.getState().updateMemberBlockStatus(blockerId, blocked);
    };

    // ✅ F3: presence intention status update
    const onPresenceStatusUpdate = ({
      userId, status, note, expires_at,
    }: { userId: string; status: 'free' | 'busy' | 'dnd' | null; note: string | null; expires_at: number | null }) => {
      useChatsStore.getState().updateMemberPresence(userId, status, note, expires_at);
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
    socket.on('block-status-changed',      onBlockStatusChanged);   // ✅
    socket.on('presence-status-update',   onPresenceStatusUpdate); // ✅ F3

    // ── F4: Shared notes ─────────────────────────────────────────────────────────
    const onNoteCreated = ({ chatId, note }: { chatId: string; note: SharedNote }) => {
      useNotesStore.getState().upsertNote(chatId, note);
    };
    const onNoteUpdated = ({ chatId, note }: { chatId: string; note: SharedNote }) => {
      useNotesStore.getState().upsertNote(chatId, note);
    };
    const onNoteDeleted = ({ chatId, noteId }: { chatId: string; noteId: string }) => {
      useNotesStore.getState().removeNote(chatId, noteId);
    };

    socket.on('note:created', onNoteCreated); // ✅ F4
    socket.on('note:updated', onNoteUpdated); // ✅ F4
    socket.on('note:deleted', onNoteDeleted); // ✅ F4

    // ── «Вопрос дня»: ответы ──────────────────────────────────────────────────
    // Обновляем счётчик на карточке-вопросе в ленте + пробрасываем событие в
    // открытый тред (DailyPromptThreadModal слушает window-событие).
    const updatePromptCount = (chatId: string, instanceId: string, count: number) => {
      const state = useChatsStore.getState();
      if (state.activeChatId !== chatId) return;
      state.setMessages(state.messages.map(m => {
        if (m.daily_prompt && m.daily_prompt.instance_id === instanceId) {
          return { ...m, daily_prompt: { ...m.daily_prompt, answer_count: count } };
        }
        return m;
      }));
    };
    const onDailyPromptAnswer = (p: { chat_id: string; instance_id: string; answer_count: number }) => {
      updatePromptCount(p.chat_id, p.instance_id, p.answer_count);
      window.dispatchEvent(new CustomEvent('dp-answer', { detail: p }));
    };
    const onDailyPromptAnswerDeleted = (p: { chat_id: string; instance_id: string; answer_count: number }) => {
      updatePromptCount(p.chat_id, p.instance_id, p.answer_count);
      window.dispatchEvent(new CustomEvent('dp-answer-deleted', { detail: p }));
    };
    socket.on('daily-prompt-answer',         onDailyPromptAnswer);
    socket.on('daily-prompt-answer-deleted', onDailyPromptAnswerDeleted);

    // ── E3: Call signaling ───────────────────────────────────────────────────────

    const onCallIncoming = ({
      callId, callerId, chatId, callType, callerInfo,
    }: { callId: string; callerId: string; chatId: string; callType: 'audio' | 'video'; callerInfo: User }) => {
      const callStore = useCallStore.getState();
      // Auto-reject if already in a call
      if (callStore.status !== 'idle') {
        emitCallReject(callId);
        return;
      }
      callStore.handleIncomingCall({ callId, chatId, callType, peerId: callerId, peerInfo: callerInfo });
    };

    const onCallAccepted = ({ callId }: { callId: string }) => {
      const callStore = useCallStore.getState();
      if (callStore.callId !== callId) return;
      // Caller: kick off the WebRTC offer now that the callee picked up
      webrtcManager.initiateOffer(callId, callStore.callType);
    };

    const onCallRejected = ({ callId }: { callId: string }) => {
      const callStore = useCallStore.getState();
      if (callStore.callId !== callId) return;
      webrtcManager.hangup(null, false, 'rejected');
    };

    const onCallOffer = ({ callId, sdp }: { callId: string; sdp: RTCSessionDescriptionInit }) => {
      const callStore = useCallStore.getState();
      if (callStore.callId !== callId) return;
      webrtcManager.handleOffer(callId, callStore.callType, sdp);
    };

    const onCallAnswer = ({ callId, sdp }: { callId: string; sdp: RTCSessionDescriptionInit }) => {
      const callStore = useCallStore.getState();
      if (callStore.callId !== callId) return;
      webrtcManager.handleAnswer(sdp);
    };

    const onCallIceCandidate = ({
      callId, candidate,
    }: { callId: string; candidate: RTCIceCandidateInit }) => {
      const callStore = useCallStore.getState();
      if (callStore.callId !== callId) return;
      webrtcManager.addIceCandidate(candidate);
    };

    const onCallEnded = ({ callId }: { callId: string }) => {
      const callStore = useCallStore.getState();
      if (callStore.callId !== callId) return;
      webrtcManager.hangup(null, false, 'ended');
    };

    const onCallBusy = ({ callId }: { callId: string }) => {
      const callStore = useCallStore.getState();
      if (callStore.callId !== callId) return;
      console.warn('[Call] ← call:busy — callee is in another call');
      webrtcManager.hangup(null, false, 'busy');
    };

    const onCallError = ({ callId, reason }: { callId: string; reason?: string }) => {
      const callStore = useCallStore.getState();
      console.warn(`[Call] ← call:error reason=${reason} (store.callId=${callStore.callId} event.callId=${callId})`);
      if (callStore.callId !== callId) return;
      webrtcManager.hangup(null, false, 'failed');
    };

    socket.on('call:incoming',      onCallIncoming);     // ✅ E3
    socket.on('call:accepted',      onCallAccepted);     // ✅ E3
    socket.on('call:rejected',      onCallRejected);     // ✅ E3
    socket.on('call:offer',         onCallOffer);        // ✅ E3
    socket.on('call:answer',        onCallAnswer);       // ✅ E3
    socket.on('call:ice-candidate', onCallIceCandidate); // ✅ E3
    socket.on('call:ended',         onCallEnded);        // ✅ E3
    socket.on('call:busy',          onCallBusy);         // ✅ E3
    socket.on('call:error',         onCallError);        // ✅ E3

    return () => {
      socket.off('connect',              onConnect);
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
      socket.off('block-status-changed',      onBlockStatusChanged);
      socket.off('presence-status-update',   onPresenceStatusUpdate);
      socket.off('call:incoming',      onCallIncoming);
      socket.off('call:accepted',      onCallAccepted);
      socket.off('call:rejected',      onCallRejected);
      socket.off('call:offer',         onCallOffer);
      socket.off('call:answer',        onCallAnswer);
      socket.off('call:ice-candidate', onCallIceCandidate);
      socket.off('call:ended',         onCallEnded);
      socket.off('call:busy',          onCallBusy);
      socket.off('call:error',         onCallError);
      socket.off('note:created', onNoteCreated);
      socket.off('note:updated', onNoteUpdated);
      socket.off('note:deleted', onNoteDeleted);
      socket.off('daily-prompt-answer',         onDailyPromptAnswer);
      socket.off('daily-prompt-answer-deleted', onDailyPromptAnswerDeleted);
      document.removeEventListener('visibilitychange', ensureAlive);
      window.removeEventListener('focus', ensureAlive);
      window.removeEventListener('pageshow', ensureAlive);
      window.removeEventListener('online', onOnline);
      clearTimeout(pushTimer);
      if (_markReadTimer) clearTimeout(_markReadTimer);
      disconnectSocket();
    };
  }, [meId]); // eslint-disable-line
}
