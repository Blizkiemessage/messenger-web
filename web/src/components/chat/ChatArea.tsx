/**
 * ChatArea — no getState() during render, only proper hooks.
 */
import { useState, useCallback } from 'react';
import { useChatsStore, selectActiveChat } from '../../store/useChatsStore';
import { useSessionStore } from '../../store/useSessionStore';
import { useAppStore } from '../../store/useAppStore';
import { useMessages } from '../../hooks/useMessages';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { EmptyState } from './EmptyState';

export function ChatArea() {
  const me = useSessionStore(s => s.me)!;
  const activeChat = useChatsStore(selectActiveChat);
  const messages = useChatsStore(s => s.messages);
  const loadingMessages = useChatsStore(s => s.loadingMessages);
  const selectedIds = useChatsStore(s => s.selectedIds);
  const toggleSelect = useChatsStore(s => s.toggleSelect);
  const clearSelection = useChatsStore(s => s.clearSelection);
  const hasSelection = selectedIds.size > 0;
  const partnerReadAt = activeChat?.partner_last_read_at ?? 0;

  const setShowDeleteConfirm = useAppStore(s => s.setShowDeleteConfirm);
  const setShowGroupInfo = useAppStore(s => s.setShowGroupInfo);
  const setViewUserId = useAppStore(s => s.setViewUserId);

  const [messageText, setMessageText] = useState('');
  const { sendMessage } = useMessages();

  const handleSend = useCallback(async () => {
    const text = messageText.trim();
    if (!text) return;
    setMessageText('');
    await sendMessage(text);
  }, [messageText, sendMessage]);

  if (!activeChat) return <EmptyState />;

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
      />
      <Composer
        value={messageText}
        onChange={setMessageText}
        onSend={handleSend}
      />
    </>
  );
}
