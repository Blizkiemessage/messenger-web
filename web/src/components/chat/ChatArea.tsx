/**
 * ChatArea.tsx
 * ✅ Added: drag-and-drop file handling, onSendWithFile handler.
 */
import { useState, useCallback, useMemo, useRef } from 'react';
import { useChatsStore, selectActiveChat } from '../../store/useChatsStore';
import { useSessionStore } from '../../store/useSessionStore';
import { useAppStore } from '../../store/useAppStore';
import { useMessages } from '../../hooks/useMessages';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { EmptyState } from './EmptyState';

import { sendChatMessage } from '../../api/chats';

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

  const [messageText, setMessageText] = useState('');
  const { sendMessage } = useMessages();

  // ── Search ────────────────────────────────────────────────────────────────
  const [searchOpen,  setSearchOpen]  = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIdx,   setSearchIdx]   = useState(0);

  const matchedIds = useMemo<string[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return messages
      .filter(m => !m.is_system && m.text?.toLowerCase().includes(q))
      .map(m => m.id);
  }, [messages, searchQuery]);

  const currentMatchId = matchedIds.length > 0 ? matchedIds[searchIdx] : null;

  const handleToggleSearch = useCallback(() => {
    setSearchOpen(v => { if (v) { setSearchQuery(''); setSearchIdx(0); } return !v; });
  }, []);
  const handleSearchChange = useCallback((q: string) => { setSearchQuery(q); setSearchIdx(0); }, []);
  const handleSearchNext   = useCallback(() => setSearchIdx(i => (i + 1) % matchedIds.length), [matchedIds.length]);
  const handleSearchPrev   = useCallback(() => setSearchIdx(i => (i - 1 + matchedIds.length) % matchedIds.length), [matchedIds.length]);
  const handleSearchClose  = useCallback(() => { setSearchOpen(false); setSearchQuery(''); setSearchIdx(0); }, []);

  // ── Send text ─────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = messageText.trim();
    if (!text) return;
    setMessageText('');
    await sendMessage(text);
  }, [messageText, sendMessage]);

  // ── Send file ─────────────────────────────────────────────────────────────
  // ✅ Called by Composer after upload is complete — just sends the message
  const handleSendAttachment = useCallback(async (
    result: { url: string; type: string; name: string; size: number },
    caption: string,
  ) => {
    const chatId = useChatsStore.getState().activeChatId;
    if (!chatId) return;
    await sendChatMessage(chatId, {
      text:            caption.trim() || '',
      attachment_url:  result.url,
      attachment_type: result.type,
      attachment_name: result.name,
      attachment_size: result.size,
    });
  }, []);

  // ── Drag & drop ───────────────────────────────────────────────────────────
  const [dragOver, setDragOver]       = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes('Files')) setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) setDroppedFile(file);
  }, []);

  const handleDroppedFileConsumed = useCallback(() => setDroppedFile(null), []);

  if (!activeChat) return <EmptyState />;

  const isGroupClosed = activeChat.type === 'group' && activeChat.is_closed === true;

  return (
    <div
      className="chatAreaInner"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag & drop overlay */}
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

      <ChatHeader
        chat={activeChat}
        meId={me.id}
        hasSelection={hasSelection}
        selectedCount={selectedIds.size}
        onCancelSelection={clearSelection}
        onDeleteSelected={() => setShowDeleteConfirm(true)}
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
        searchQuery={searchQuery.trim().toLowerCase()}
        matchedIds={matchedIds}
        currentMatchId={currentMatchId}
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
          onExternalFileConsumed={handleDroppedFileConsumed}
        />
      )}
    </div>
  );
}
