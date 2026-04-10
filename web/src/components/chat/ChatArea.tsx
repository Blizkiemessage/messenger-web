/**
 * ChatArea.tsx
 * ✅ Added: pin/unpin messages, pin navigation, long message auto-split.
 */
import { useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { useChatsStore, selectActiveChat } from '../../store/useChatsStore';
import { useSessionStore } from '../../store/useSessionStore';
import { useAppStore } from '../../store/useAppStore';
import { useMessages } from '../../hooks/useMessages';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { EmptyState } from './EmptyState';
import { ReplyPreviewBar } from './ReplyPreviewBar';
import { sendChatMessage, getPinnedMessages, pinMessage as apiPin, unpinMessage as apiUnpin, reactToMessage, editMessage as apiEditMessage } from '../../api/chats';
import { createPoll, votePoll, retractVote } from '../../api/polls';
import { emitTypingStart, emitTypingStop } from '../../socket/socketClient';
import { scheduleMarkRead } from '../../hooks/useSocket';
import type { CreatePollData } from '../../api/polls';
import type { UploadResult } from '../../api/upload';
import type { Message } from '../../types';
import { ForwardModal } from '../modals/ForwardModal';
import { PollCreatorModal } from './PollCreatorModal';
import { PollVotersModal } from './PollVotersModal';
import { MediaPlayerProvider } from '../../contexts/MediaPlayerContext';
import { MiniPlayer } from './MiniPlayer';

// ── Max chars per message — split at last word boundary ──────────────────────
const MAX_MSG_CHARS = 4000;

// Stable empty array so the typingUsers selector doesn't create a new reference
// on every render (which would cause an infinite re-render loop).
const EMPTY_TYPING: string[] = [];

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

  const setShowDeleteConfirm  = useAppStore(s => s.setShowDeleteConfirm);
  const setDeleteForEveryone  = useAppStore(s => s.setDeleteForEveryone);
  const setShowGroupInfo      = useAppStore(s => s.setShowGroupInfo);
  const setViewUserId         = useAppStore(s => s.setViewUserId);

  // ── Forward state ─────────────────────────────────────────────────────────
  const forwardingIds     = useAppStore(s => s.forwardingIds);
  const showForwardModal  = useAppStore(s => s.showForwardModal);
  const setForwardingIds  = useAppStore(s => s.setForwardingIds);
  const setShowForwardModal = useAppStore(s => s.setShowForwardModal);

  const [messageText, setMessageText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mentionBannerId, setMentionBannerId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [voterModal, setVoterModal] = useState<{ pollId: string; optionId: string; optionText: string } | null>(null);
  const { loadOlderMessages } = useMessages();
  const hasMoreMessages = useChatsStore(s => s.hasMoreMessages);
  const activeChatId = useChatsStore(s => s.activeChatId);
  const typingUserIds = useChatsStore(s => s.typingUsers.get(s.activeChatId ?? '') ?? EMPTY_TYPING);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    await loadOlderMessages();
    setLoadingMore(false);
  }, [loadingMore, loadOlderMessages]);

  // ── Reply state ───────────────────────────────────────────────────────────
  const [replyTo, setReplyTo] = useState<{
    messageId: string;
    senderId: string;
    senderName: string;
    quotedText: string;
  } | null>(null);

  const [scrollTargetId, setScrollTargetId] = useState<string | null>(null);

  // ── Composer area height + scroll-to-bottom button state ────────────────
  const bottomAreaRef      = useRef<HTMLDivElement | null>(null);
  const chatAreaInnerRef   = useRef<HTMLDivElement | null>(null);
  const [chatAtBottom, setChatAtBottom]     = useState(true);
  const scrollToBottomFnRef                 = useRef<() => void>(() => {});

  // Sync composer height to CSS var --composer-h on chatAreaInner via ResizeObserver.
  // useLayoutEffect + activeChatId dep: re-runs whenever a chat is selected so refs
  // are guaranteed to be populated. Synchronous update prevents any paint delay.
  useLayoutEffect(() => {
    const el = bottomAreaRef.current;
    const container = chatAreaInnerRef.current;
    if (!el || !container) return;
    const update = () => container.style.setProperty('--composer-h', `${el.offsetHeight}px`);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, [activeChatId]);

  // ── Clear stale input state on chat switch ────────────────────────────────
  useEffect(() => {
    setMessageText('');
    setEditingId(null);
    setReplyTo(null);
  }, [activeChatId]); // eslint-disable-line

  // ── Global search scroll target ───────────────────────────────────────────
  const scrollToMessageId    = useChatsStore(s => s.scrollToMessageId);
  const setScrollToMessageId = useChatsStore(s => s.setScrollToMessageId);
  useEffect(() => {
    if (scrollToMessageId) {
      setScrollTargetId(scrollToMessageId);
      setScrollToMessageId(null);
    }
  }, [scrollToMessageId, setScrollToMessageId]);

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

  // ── Mention banner: detect @me in unread messages on chat entry ───────────
  useEffect(() => {
    setMentionBannerId(null);
    if (!activeChat || !me.username || (activeChat.unread_count ?? 0) === 0) return;
    const myHandle = '@' + me.username.toLowerCase();
    const unread = messages.slice(-(activeChat.unread_count ?? 0));
    const found = unread.find(m =>
      m.sender_id !== me.id && !m.is_system && m.text?.toLowerCase().includes(myHandle)
    );
    if (found) setMentionBannerId(found.id);
  }, [activeChatId, messages.length]); // eslint-disable-line

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

  // Delete single message from context menu — selects it then opens confirm modal
  const handleDeleteSingle = useCallback((msgId: string) => {
    const allMessages = useChatsStore.getState().messages;
    if (selectedIds.size <= 1) {
      clearSelection();
      toggleSelect(msgId);
      // Default scope: own message → "for all"; others' → "for me"
      const msg = allMessages.find(m => m.id === msgId);
      setDeleteForEveryone(msg?.sender_id === me.id);
    } else {
      // Multi-select: if any non-own message, default to "for me"
      const hasOthers = Array.from(selectedIds).some(
        id => allMessages.find(m => m.id === id)?.sender_id !== me.id
      );
      setDeleteForEveryone(!hasOthers);
    }
    setShowDeleteConfirm(true);
  }, [selectedIds, clearSelection, toggleSelect, setShowDeleteConfirm, setDeleteForEveryone, me.id]);

  // ✅ "Add more" — close the modal and pre-select already-queued messages so user just taps extras
  const handleForwardAddMore = useCallback(() => {
    setShowForwardModal(false);
    // Pre-select already-queued messages so they're highlighted in the chat
    const store = useChatsStore.getState();
    store.clearSelection();
    (forwardingIds ?? []).forEach(id => store.toggleSelect(id));
  }, [setShowForwardModal, forwardingIds]);

  // ── Reply handlers ────────────────────────────────────────────────────────
  const handleReply = useCallback((msg: Message, selectedText: string) => {
    const sender = activeChat?.members.find(m => m.id === msg.sender_id);
    const senderName = sender?.display_name || sender?.username || 'Пользователь';
    setReplyTo({
      messageId: msg.id,
      senderId: msg.sender_id,
      senderName,
      quotedText: selectedText || msg.text || '',
    });
  }, [activeChat]);

  const handleCancelReply = useCallback(() => setReplyTo(null), []);

  // ── React handler ─────────────────────────────────────────────────────────
  const handleReact = useCallback(async (msgId: string, emoji: string) => {
    if (!activeChat) return;
    try {
      const { reactions } = await reactToMessage(activeChat.id, msgId, emoji);
      useChatsStore.getState().setMessages(
        useChatsStore.getState().messages.map(m =>
          m.id === msgId ? { ...m, reactions } : m
        )
      );
    } catch { /* socket will update state */ }
  }, [activeChat]);

  // ── Edit handlers ─────────────────────────────────────────────────────────
  const handleStartEdit = useCallback((msgId: string) => {
    const msg = useChatsStore.getState().messages.find(m => m.id === msgId);
    if (!msg) return;
    setEditingId(msgId);
    setMessageText(msg.text || '');
    setReplyTo(null);
    clearSelection();
  }, [clearSelection]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setMessageText('');
  }, []);

  // ── Mark-read via scroll ──────────────────────────────────────────────────
  const handleMarkRead = useCallback((readUntil: number) => {
    const chatId = useChatsStore.getState().activeChatId;
    if (!chatId) return;
    scheduleMarkRead(chatId, readUntil);
  }, []);

  // ── Send text (with auto-split) ───────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = messageText.trim();
    if (!text) return;
    setMessageText('');
    // Stop typing indicator immediately on send
    const cid = useChatsStore.getState().activeChatId;
    if (cid) emitTypingStop(cid);

    if (editingId) {
      const chatId = useChatsStore.getState().activeChatId;
      if (!chatId) return;
      const id = editingId;
      setEditingId(null);
      try {
        const updated = await apiEditMessage(chatId, id, text);
        useChatsStore.getState().setMessages(
          useChatsStore.getState().messages.map(m => m.id === updated.id ? updated : m)
        );
      } catch { /* socket will update */ }
      return;
    }

    const chatId = useChatsStore.getState().activeChatId;
    if (!chatId) return;
    const parts = splitMessage(text);
    // Attach reply only to the first part
    const replyPayload = replyTo ? {
      id: replyTo.messageId,
      sender_id: replyTo.senderId,
      sender_username: replyTo.senderName,
      quoted_text: replyTo.quotedText,
    } : undefined;
    setReplyTo(null);
    for (let i = 0; i < parts.length; i++) {
      await sendChatMessage(chatId, {
        text: parts[i],
        reply: i === 0 ? replyPayload : undefined,
      });
    }
  }, [messageText, replyTo, editingId]);

  // ── Send attachment ───────────────────────────────────────────────────────
  const handleSendAttachment = useCallback(async (result: UploadResult, caption: string) => {
    const chatId = useChatsStore.getState().activeChatId;
    if (!chatId) return;
    await sendChatMessage(chatId, {
      text: caption.trim() || '',
      attachment_url:      result.url,
      attachment_type:     result.type,
      attachment_name:     result.name,
      attachment_size:     result.size,
      attachment_duration: result.duration ?? null,
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

  // ── Poll handlers ─────────────────────────────────────────────────────────
  const handleSendPoll = useCallback(async (data: CreatePollData) => {
    const chatId = useChatsStore.getState().activeChatId;
    if (!chatId) return;
    const { message } = await createPoll(chatId, data);
    // Socket will broadcast new-message; optimistic add just in case
    useChatsStore.getState().addMessage(message as Message);
  }, []);

  const handleVote = useCallback(async (msgId: string, optionIds: string[]) => {
    const msg = useChatsStore.getState().messages.find(m => m.id === msgId);
    if (!msg?.poll_id) return;
    try {
      const { poll } = await votePoll(msg.poll_id, optionIds);
      useChatsStore.getState().updateMessagePoll(msgId, poll);
    } catch { /* socket will update */ }
  }, []);

  const handleRetract = useCallback(async (msgId: string) => {
    const msg = useChatsStore.getState().messages.find(m => m.id === msgId);
    if (!msg?.poll_id) return;
    try {
      const { poll } = await retractVote(msg.poll_id);
      useChatsStore.getState().updateMessagePoll(msgId, poll);
    } catch { /* socket will update */ }
  }, []);

  const handleViewVoters = useCallback((pollId: string, optionId: string) => {
    const msgs = useChatsStore.getState().messages;
    const msg = msgs.find(m => m.poll?.id === pollId);
    const opt = msg?.poll?.options.find(o => o.id === optionId);
    setVoterModal({ pollId, optionId, optionText: opt?.text ?? '' });
  }, []);

  // ── Typing indicator text ─────────────────────────────────────────────────
  const typingText = (() => {
    if (!activeChat || typingUserIds.length === 0) return '';
    const others = typingUserIds.filter(id => id !== me.id);
    if (others.length === 0) return '';
    if (others.length === 1) {
      const member = activeChat.members.find(m => m.id === others[0]);
      const name = member?.display_name || member?.username || null;
      return name ? `${name} печатает` : 'Печатает';
    }
    return `${others.length} пользователя печатают`;
  })();

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
    <MediaPlayerProvider clearKey={activeChatId ?? ''}>
    <div
      ref={chatAreaInnerRef}
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

      {/* Poll creator modal */}
      {showPollCreator && (
        <PollCreatorModal
          onClose={() => setShowPollCreator(false)}
          onCreatePoll={handleSendPoll}
        />
      )}

      {/* Poll voters modal */}
      {voterModal && (
        <PollVotersModal
          pollId={voterModal.pollId}
          optionId={voterModal.optionId}
          optionText={voterModal.optionText}
          onClose={() => setVoterModal(null)}
        />
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
        onDeleteSelected={() => {
          const allMessages = useChatsStore.getState().messages;
          const hasOthers = Array.from(selectedIds).some(
            id => allMessages.find(m => m.id === id)?.sender_id !== me.id
          );
          setDeleteForEveryone(!hasOthers);
          setShowDeleteConfirm(true);
        }}
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
        typingText={typingText}
      />

      {/* Mini player — appears below header while audio/video is playing */}
      <MiniPlayer />

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
        onReply={handleReply}
        onReact={handleReact}
        scrollTargetId={scrollTargetId}
        onScrollTargetHandled={() => setScrollTargetId(null)}
        searchQuery={searchQuery.trim().toLowerCase()}
        matchedIds={matchedIds}
        currentMatchId={currentMatchId}
        pinnedFocusId={pinnedFocusId}
        hasMoreMessages={hasMoreMessages}
        loadingMore={loadingMore}
        onLoadMore={handleLoadMore}
        onVote={handleVote}
        onRetract={handleRetract}
        onViewVoters={handleViewVoters}
        onEdit={handleStartEdit}
        meUsername={me.username ?? undefined}
        unreadCount={activeChat?.unread_count ?? 0}
        onMarkRead={handleMarkRead}
        onAtBottomChange={setChatAtBottom}
        onScrollToBottomRef={(fn) => { scrollToBottomFnRef.current = fn; }}
      />

      {/* Scroll-to-bottom button — position:absolute inside chatAreaInner (position:relative).
          bottom is driven by CSS var --composer-h (set synchronously via ResizeObserver). */}
      {!chatAtBottom && (
        <button
          className="scrollToBottomBtn"
          onClick={() => scrollToBottomFnRef.current?.()}
          title="Перейти к последним сообщениям"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      )}

      <div ref={bottomAreaRef}>
      {isGroupClosed ? (
        <div className="groupClosedBanner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span>Группа закрыта — отправка сообщений недоступна</span>
        </div>
      ) : (
        <>
          {replyTo && !editingId && (
            <ReplyPreviewBar
              reply={replyTo}
              onCancel={handleCancelReply}
              onViewUser={setViewUserId}
              senderId={replyTo.senderId}
            />
          )}
          {mentionBannerId && !editingId && (
            <div className="mentionBanner" onClick={() => { setScrollTargetId(mentionBannerId); setMentionBannerId(null); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4"/>
                <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/>
              </svg>
              <span>Вас упомянули — нажмите, чтобы перейти</span>
              <button className="mentionBannerClose" onClick={e => { e.stopPropagation(); setMentionBannerId(null); }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          )}
          <Composer
            value={messageText}
            onChange={setMessageText}
            onSend={handleSend}
            onSendAttachment={handleSendAttachment}
            externalFile={droppedFile}
            onExternalFileConsumed={() => setDroppedFile(null)}
            isGroup={activeChat.type === 'group'}
            onOpenPollCreator={() => setShowPollCreator(true)}
            onTypingStart={() => activeChatId && emitTypingStart(activeChatId)}
            onTypingStop={() => activeChatId && emitTypingStop(activeChatId)}
            editingMessageId={editingId}
            onCancelEdit={handleCancelEdit}
            members={activeChat.type === 'group' ? (activeChat.members ?? []) : []}
            blockedByThem={activeChat.type === 'direct' && !!(activeChat.members?.find(m => m.id !== me.id) as any)?.blocked_by_them}
            partnerName={activeChat.type === 'direct' ? (activeChat.members?.find(m => m.id !== me.id)?.display_name || activeChat.members?.find(m => m.id !== me.id)?.username || undefined) : undefined}
          />
        </>
      )}
      </div>
    </div>
    </MediaPlayerProvider>
  );
}
