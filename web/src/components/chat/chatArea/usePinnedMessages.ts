/**
 * chatArea/usePinnedMessages.ts — pinned-messages feature for a chat:
 * loads the pinned list, keeps it in sync with socket updates, drives the
 * pin-navigation bar, and exposes pin/unpin handlers (single, context-menu,
 * and bulk-selection). Mirrors the previous inline logic verbatim.
 */
import { useState, useEffect, useCallback } from 'react';
import { useChatsStore } from '../../../store/useChatsStore';
import { getPinnedMessages, pinMessage as apiPin, unpinMessage as apiUnpin } from '../../../api/chats';
import type { Message, Chat } from '../../../types';

export function usePinnedMessages(
  activeChat: Chat | null | undefined,
  messages: Message[],
  selectedIds: Set<string>,
  clearSelection: () => void,
) {
  const [pinnedMessages, setPinnedMessages] = useState<Message[]>([]);
  const [pinnedOpen,     setPinnedOpen]     = useState(false);
  const [pinnedIdx,      setPinnedIdx]      = useState(0);

  // Load pinned messages when chat changes
  useEffect(() => {
    if (!activeChat) { setPinnedMessages([]); return; }
    getPinnedMessages(activeChat.id).then(setPinnedMessages).catch(() => setPinnedMessages([]));
  }, [activeChat?.id]); // eslint-disable-line

  // Also update pinnedMessages from local messages list (after socket updates)
  useEffect(() => {
    const pinned = messages.filter(m => m.is_pinned);
    if (pinned.length !== pinnedMessages.length) setPinnedMessages(pinned);
  }, [messages]); // eslint-disable-line

  const pinnedFocusId = pinnedOpen && pinnedMessages.length > 0
    ? pinnedMessages[pinnedIdx]?.id ?? null
    : null;

  const handleTogglePinned = useCallback(() => {
    setPinnedOpen(v => !v);
    setPinnedIdx(0);
  }, []);
  const handlePinnedNext = useCallback(() =>
    setPinnedIdx(i => (i + 1) % pinnedMessages.length), [pinnedMessages.length]);
  const handlePinnedPrev = useCallback(() =>
    setPinnedIdx(i => (i - 1 + pinnedMessages.length) % pinnedMessages.length), [pinnedMessages.length]);

  // ✅ Pin all selected messages
  const handlePinSelected = useCallback(async () => {
    if (!activeChat) return;
    const ids = Array.from(selectedIds);
    for (const msgId of ids) {
      try {
        const updated = await apiPin(activeChat.id, msgId);
        setPinnedMessages(prev => prev.some(m => m.id === msgId) ? prev : [...prev, updated]);
        useChatsStore.getState().setMessages(
          useChatsStore.getState().messages.map(m => m.id === msgId ? { ...m, is_pinned: true } : m)
        );
      } catch { /* upstream */ }
    }
    clearSelection();
  }, [activeChat, selectedIds, clearSelection]);

  // ✅ Unpin all selected messages
  const handleUnpinSelected = useCallback(async () => {
    if (!activeChat) return;
    const ids = Array.from(selectedIds);
    for (const msgId of ids) {
      try {
        await apiUnpin(activeChat.id, msgId);
        setPinnedMessages(prev => prev.filter(m => m.id !== msgId));
        useChatsStore.getState().setMessages(
          useChatsStore.getState().messages.map(m => m.id === msgId ? { ...m, is_pinned: false } : m)
        );
      } catch { /* upstream */ }
    }
    clearSelection();
  }, [activeChat, selectedIds, clearSelection]);

  // ✅ Pin from context menu — if multi-selection exists, pin all selected;
  //    otherwise just the right-clicked message
  const handlePinMessage = useCallback(async (msgId: string) => {
    if (!activeChat) return;
    const ids = selectedIds.size > 1 ? Array.from(selectedIds) : [msgId];
    for (const id of ids) {
      try {
        const updated = await apiPin(activeChat.id, id);
        setPinnedMessages(prev => prev.some(m => m.id === id) ? prev : [...prev, updated]);
        useChatsStore.getState().setMessages(
          useChatsStore.getState().messages.map(m => m.id === id ? { ...m, is_pinned: true } : m)
        );
      } catch { /* upstream */ }
    }
    clearSelection();
  }, [activeChat, selectedIds, clearSelection]);

  const handleUnpinMessage = useCallback(async (msgId: string) => {
    if (!activeChat) return;
    const ids = selectedIds.size > 1 ? Array.from(selectedIds) : [msgId];
    for (const id of ids) {
      try {
        await apiUnpin(activeChat.id, id);
        setPinnedMessages(prev => prev.filter(m => m.id !== id));
        useChatsStore.getState().setMessages(
          useChatsStore.getState().messages.map(m => m.id === id ? { ...m, is_pinned: false } : m)
        );
      } catch { /* upstream */ }
    }
    clearSelection();
  }, [activeChat, selectedIds, clearSelection]);

  return {
    pinnedMessages, pinnedOpen, pinnedIdx, pinnedFocusId,
    handleTogglePinned, handlePinnedNext, handlePinnedPrev,
    handlePinSelected, handleUnpinSelected, handlePinMessage, handleUnpinMessage,
  };
}
