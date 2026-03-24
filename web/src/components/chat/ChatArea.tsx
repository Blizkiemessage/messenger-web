/**
 * ChatArea.tsx
 * ✅ Added: pin/unpin messages, pin navigation, long message auto-split.
 */
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useChatsStore, selectActiveChat } from '../../store/useChatsStore';
import { useSessionStore } from '../../store/useSessionStore';
import { useAppStore } from '../../store/useAppStore';
import { useMessages } from '../../hooks/useMessages';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { EmptyState } from './EmptyState';
import { sendChatMessage, getPinnedMessages, pinMessage as apiPin, unpinMessage as apiUnpin } from '../../api/chats';
import type { UploadResult } from '../../api/upload';
import type { Message } from '../../types';
import { ForwardModal } from '../modals/ForwardModal';

// ── Max chars per message — split at last word boundary ──────────────────────
const MAX_MSG_CHARS = 4000;

function splitMessage(text: string): string[] {
  if (text.length <= MAX_MSG_CHARS) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_MSG_CHARS) {
    // Find last space within the limit
    let cutAt = remaining.lastIndexOf(' ', MAX_MSG_CHARS);
    if (cutAt <= 0) cutAt = MAX_MSG_CHARS; // no space found — hard cut
    parts.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt).trimStart();
  }
  if (remaining.length > 0) parts.push(remaining);
  return parts;
}

export function ChatArea() {
  const me              = useSessionStore(s => s.me)!;
  const activeChat      = useChatsStore(selectActiveChat);
  const messages        = useChatsStore(s => s.messages);
  const loadingMessages = useChatsStore(s => s.loadingMessages);
  const selectedIds     = useChatsStore(s => s.selectedIds);
  const toggleSelect    = useChatsStore(s => s.toggleSelect);
  const clearSelection  = useChatsStore(s => s.clearSelection);
  const hasSelection    = selectedIds.size > 0;
  const partnerReadAt   = activeChat?.partner_last_read_at ?? 0;

  const setShowDeleteConfirm = useAppStore(s => s.setShowDeleteConfirm);
  const setShowGroupInfo     = useAppStore(s => s.setShowGroupInfo);
  const setViewUserId        = useAppStore(s => s.setViewUserId);

  // ── Forward state ─────────────────────────────────────────────────────────
  const forwardingIds     = useAppStore(s => s.forwardingIds);
  const showForwardModal  = useAppStore(s => s.showForwardModal);
  const setForwardingIds  = useAppStore(s => s.setForwardingIds);
  const setShowForwardModal = useAppStore(s => s.setShowForwardModal);

  const [messageText, setMessageText] = useState('');
  useMessages(); // keeps message loading side-effect

  // ── Search ────────────────────────────────────────────────────────────────
  const [searchOpen,  setSearchOpen]  = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIdx,   setSearchIdx]   = useState(0);

  const matchedIds = useMemo<string[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return messages.filter(m => !m.is_system && m.text?.toLowerCase().includes(q)).map(m => m.id);
  }, [messages, searchQuery]);

  const currentMatchId = matchedIds.length > 0 ? matchedIds[searchIdx] : null;

  const handleToggleSearch = useCallback(() => {
    setSearchOpen(v => { if (v) { setSearchQuery(''); setSearchIdx(0); } return !v; });
  }, []);
  const handleSearchChange = useCallback((q: string) => { setSearchQuery(q); setSearchIdx(0); }, []);
  const handleSearchNext   = useCallback(() => setSearchIdx(i => (i + 1) % matchedIds.length), [matchedIds.length]);
  const handleSearchPrev   = useCallback(() => setSearchIdx(i => (i - 1 + matchedIds.length) % matchedIds.length), [matchedIds.length]);
  const handleSearchClose  = useCallback(() => { setSearchOpen(false); setSearchQuery(''); setSearchIdx(0); }, []);

  // ── Pinned messages ───────────────────────────────────────────────────────
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

  // ✅ Forward selected messages — open modal
  const handleForwardSelected = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setForwardingIds(ids);
    setShowForwardModal(true);
    clearSelection();
  }, [selectedIds, setForwardingIds, setShowForwardModal, clearSelection]);

  // ✅ Forward from context menu — if there's a multi-selection, forward all selected;
  //    otherwise just the right-clicked message
  const handleForwardSingle = useCallback((msgId: string) => {
    const ids = selectedIds.size > 1
      ? Array.from(selectedIds)
      : [msgId];
    setForwardingIds(ids);
    setShowForwardModal(true);
    clearSelection();
  }, [selectedIds, setForwardingIds, setShowForwardModal, clearSelection]);

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

  // ✅ Delete single message from context menu — selects it then opens confirm modal
  const handleDeleteSingle = useCallback((msgId: string) => {
    clearSelection();
    toggleSelect(msgId);
    setShowDeleteConfirm(true);
  }, [clearSelection, toggleSelect, setShowDeleteConfirm]);

  // ✅ "Add more" — close the modal and pre-select already-queued messages so user just taps extras
  const handleForwardAddMore = useCallback(() => {
    setShowForwardModal(false);
    // Pre-select already-queued messages so they're highlighted in the chat
    const store = useChatsStore.getState();
    store.clearSelection();
    (forwardingIds ?? []).forEach(id => store.toggleSelect(id));
  }, [setShowForwardModal, forwardingIds]);

  // ── Send text (with auto-split) ───────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = messageText.trim();
    if (!text) return;
    setMessageText('');
    const chatId = useChatsStore.getState().activeChatId;
    if (!chatId) return;
    const parts = splitMessage(text);
    for (const part of parts) {
      await sendChatMessage(chatId, { text: part });
    }
  }, [messageText]);

  // ── Send attachment ───────────────────────────────────────────────────────
  const handleSendAttachment = useCallback(async (result: UploadResult, caption: string) => {
    const chatId = useChatsStore.getState().activeChatId;
    if (!chatId) return;
    await sendChatMessage(chatId, {
      text: caption.trim() || '',
      attachment_url:  result.url,
      attachment_type: result.type,
      attachment_name: result.name,
      attachment_size: result.size,
    });
  }, []);

  // ── Drag & drop ───────────────────────────────────────────────────────────
  const [dragOver,     setDragOver]     = useState(false);
  const [droppedFile,  setDroppedFile]  = useState<File | null>(null);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault(); dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) setDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); dragCounter.current--;
    if (dragCounter.current === 0) setDragOver(false);
  }, []);
  const handleDragOver  = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }, []);
  const handleDrop      = useCallback((e: React.DragEvent) => {
    e.preventDefault(); dragCounter.current = 0; setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) setDroppedFile(file);
  }, []);

  if (!activeChat) return <EmptyState />;

  const isGroupClosed = activeChat.type === 'group' && activeChat.is_closed === true;

  // true when every selected message is already pinned → show "Открепить" instead of "Закрепить"
  const allSelectedPinned = selectedIds.size > 0 &&
    Array.from(selectedIds).every(id => messages.find(m => m.id === id)?.is_pinned);

  // messages currently queued for forwarding
  const forwardMessages = forwardingIds
    ? messages.filter(m => forwardingIds.includes(m.id))
    : [];

  // If user hit "Add more" — show a sticky banner at the top of chat
  const isAddingMore = forwardingIds !== null && !showForwardModal;

  return (
    <div
      className="chatAreaInner"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="dropOverlay">
          <div className="dropOverlayBox">
            <div className="dropOverlayIcon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            </div>
            <div className="dropOverlayTitle">Перетащите файл сюда</div>
            <div className="dropOverlaySub">Файл будет прикреплён к сообщению</div>
          </div>
        </div>
      )}

      {/* ✅ "Add more" banner — shown when user returned to chat to pick more messages */}
      {isAddingMore && (
        <div className="fwdAddMoreBanner">
          <div className="fwdAddMoreLeft">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 17 20 12 15 7"/>
              <path d="M4 18v-2a4 4 0 0 1 4-4h12"/>
            </svg>
            <span>Выбрано {forwardingIds?.length ?? 0} сообщ. — выберите ещё или нажмите «Готово»</span>
          </div>
          <div className="fwdAddMoreRight">
            <button className="fwdAddMoreDone" onClick={() => {
              // selectedIds now includes pre-selected (queued) + any newly tapped ones
              const merged = Array.from(selectedIds);
              setForwardingIds(merged.length > 0 ? merged : forwardingIds);
              clearSelection();
              setShowForwardModal(true);
            }}>
              Готово ({selectedIds.size})
            </button>
            <button className="fwdAddMoreCancel" onClick={() => { setForwardingIds(null); clearSelection(); }}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* ✅ Forward modal */}
      {showForwardModal && forwardMessages.length > 0 && (
        <ForwardModal
          messages={forwardMessages}
          meId={me.id}
          onClose={() => { setShowForwardModal(false); setForwardingIds(null); }}
          onAddMore={handleForwardAddMore}
        />
      )}

      <ChatHeader
        chat={activeChat}
        meId={me.id}
        hasSelection={hasSelection}
        selectedCount={selectedIds.size}
        onCancelSelection={clearSelection}
        onDeleteSelected={() => setShowDeleteConfirm(true)}
        onForwardSelected={handleForwardSelected}
        onPinSelected={handlePinSelected}
        onUnpinSelected={handleUnpinSelected}
        allSelectedPinned={allSelectedPinned}
        onOpenInfo={() => setShowGroupInfo(true)}
        onViewUser={setViewUserId}
        searchOpen={searchOpen}
        searchQuery={searchQuery}
        searchTotal={matchedIds.length}
        searchCurrent={searchIdx}
        onToggleSearch={handleToggleSearch}
        onSearchChange={handleSearchChange}
        onSearchNext={handleSearchNext}
        onSearchPrev={handleSearchPrev}
        onSearchClose={handleSearchClose}
        pinnedCount={pinnedMessages.length}
        pinnedOpen={pinnedOpen}
        pinnedIndex={pinnedIdx}
        onTogglePinned={handleTogglePinned}
        onPinnedNext={handlePinnedNext}
        onPinnedPrev={handlePinnedPrev}
      />

      <MessageList
        messages={messages}
        chat={activeChat}
        meId={me.id}
        partnerReadAt={partnerReadAt}
        selectedIds={selectedIds}
        hasSelection={hasSelection}
        loadingMessages={loadingMessages}
        onToggleSelect={toggleSelect}
        onClearSelection={clearSelection}
        onViewUser={setViewUserId}
        onPinMessage={handlePinMessage}
        onUnpinMessage={handleUnpinMessage}
        onDeleteSingle={handleDeleteSingle}
        onForwardSingle={handleForwardSingle}
        searchQuery={searchQuery.trim().toLowerCase()}
        matchedIds={matchedIds}
        currentMatchId={currentMatchId}
        pinnedFocusId={pinnedFocusId}
      />

      {isGroupClosed ? (
        <div className="groupClosedBanner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span>Группа закрыта — отправка сообщений недоступна</span>
        </div>
      ) : (
        <Composer
          value={messageText}
          onChange={setMessageText}
          onSend={handleSend}
          onSendAttachment={handleSendAttachment}
          externalFile={droppedFile}
          onExternalFileConsumed={() => setDroppedFile(null)}
        />
      )}
    </div>
  );
}
