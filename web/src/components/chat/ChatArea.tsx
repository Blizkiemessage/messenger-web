/**
 * ChatArea — wires search state between ChatHeader and MessageList.
 * ✅ Hides Composer for closed groups and shows a "group closed" banner instead.
 */
import { useState, useCallback, useMemo } from 'react';
import { useChatsStore, selectActiveChat } from '../../store/useChatsStore';
import { useSessionStore } from '../../store/useSessionStore';
import { useAppStore } from '../../store/useAppStore';
import { useMessages } from '../../hooks/useMessages';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { EmptyState } from './EmptyState';

export function ChatArea() {
  const me            = useSessionStore(s => s.me)!;
  const activeChat    = useChatsStore(selectActiveChat);
  const messages      = useChatsStore(s => s.messages);
  const loadingMessages = useChatsStore(s => s.loadingMessages);
  const selectedIds   = useChatsStore(s => s.selectedIds);
  const toggleSelect  = useChatsStore(s => s.toggleSelect);
  const clearSelection = useChatsStore(s => s.clearSelection);
  const hasSelection  = selectedIds.size > 0;
  const partnerReadAt = activeChat?.partner_last_read_at ?? 0;

  const setShowDeleteConfirm = useAppStore(s => s.setShowDeleteConfirm);
  const setShowGroupInfo     = useAppStore(s => s.setShowGroupInfo);
  const setViewUserId        = useAppStore(s => s.setViewUserId);

  const [messageText, setMessageText] = useState('');
  const { sendMessage } = useMessages();

  // ── Search state ──────────────────────────────────────────────────────────
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
    setSearchOpen(v => {
      if (v) { setSearchQuery(''); setSearchIdx(0); }
      return !v;
    });
  }, []);

  const handleSearchChange = useCallback((q: string) => {
    setSearchQuery(q);
    setSearchIdx(0);
  }, []);

  const handleSearchNext = useCallback(() => {
    setSearchIdx(i => (i + 1) % matchedIds.length);
  }, [matchedIds.length]);

  const handleSearchPrev = useCallback(() => {
    setSearchIdx(i => (i - 1 + matchedIds.length) % matchedIds.length);
  }, [matchedIds.length]);

  const handleSearchClose = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchIdx(0);
  }, []);

  const handleSend = useCallback(async () => {
    const text = messageText.trim();
    if (!text) return;
    setMessageText('');
    await sendMessage(text);
  }, [messageText, sendMessage]);

  if (!activeChat) return <EmptyState />;

  // ✅ Determine if the group is closed
  const isGroupClosed = activeChat.type === 'group' && activeChat.is_closed === true;

  return (
    <>
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

      {/* ✅ Show closed banner OR composer */}
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
        />
      )}
    </>
  );
}
