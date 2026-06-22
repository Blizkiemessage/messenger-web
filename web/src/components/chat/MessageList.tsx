/**
 * MessageList
 * ✅ Context menu via Portal (escapes overflow stacking context).
 * ✅ "Удалить" button wired to onDeleteSingle — selects + opens confirm modal.
 * ✅ Explicit background colors as fallback for CSS var(--card).
 */
import { useRef, useEffect, useLayoutEffect, useState, useCallback, lazy, Suspense } from 'react';
import { type Message, type Chat, type MessageReaction } from '../../types';
import { dayKey, formatDateSeparator } from '../../utils/format';
import { MessageBubble } from './MessageBubble';
import { DailyPromptCard } from './DailyPromptCard';
import { Portal } from '../ui/Portal';
const EmojiPicker = lazy(() => import('../ui/EmojiPicker').then(m => ({ default: m.EmojiPicker })));
import { MessageReadersModal } from './MessageReadersModal';
import { StickerPackPreviewModal } from '../modals/StickerPackPreviewModal';
import { getPackById } from '../../api/sticker-packs';

interface Props {
  messages: Message[];
  chat: Chat;
  meId: string;
  partnerReadAt: number;
  selectedIds: Set<string>;
  hasSelection: boolean;
  loadingMessages: boolean;
  onToggleSelect: (id: string) => void;
  onClearSelection: () => void;
  onViewUser: (id: string) => void;
  onPinMessage: (msgId: string) => void;
  onUnpinMessage: (msgId: string) => void;
  onDeleteSingle: (msgId: string) => void;
  onForwardSingle: (msgId: string) => void;
  onReply: (msg: Message, selectedText: string) => void;
  onReact: (msgId: string, emoji: string) => void;
  scrollTargetId: string | null;
  onScrollTargetHandled: () => void;
  searchQuery: string;
  matchedIds: string[];
  currentMatchId: string | null;
  pinnedFocusId: string | null;
  hasMoreMessages: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onVote?: (msgId: string, optionIds: string[]) => void;
  onRetract?: (msgId: string) => void;
  onViewVoters?: (pollId: string, optionId: string) => void;
  onEdit: (msgId: string) => void;
  meUsername?: string;
  unreadCount?: number;
  onMarkRead?: (readUntil: number) => void;
  /** Called whenever the list scrolls to/from the bottom (drives the scroll button in ChatArea). */
  onAtBottomChange?: (atBottom: boolean) => void;
  /** Called once on mount; provides an imperative scroll-to-bottom function to the parent. */
  onScrollToBottomRef?: (fn: () => void) => void;
  /** Called when user taps the error badge on a failed optimistic message. */
  onRetryMessage?: (msgId: string) => void;
  /** Открыть тред ответов «Вопроса дня» по карточке в ленте. */
  onOpenDailyPrompt?: (instanceId: string) => void;
}

const CTX_WIDTH  = 200;
const CTX_HEIGHT = 280;  // taller to fit Reply + Copy + Edit + React buttons

export function MessageList({
  messages, chat, meId, partnerReadAt, selectedIds, hasSelection,
  loadingMessages, onToggleSelect, onClearSelection, onViewUser,
  onPinMessage, onUnpinMessage, onDeleteSingle, onForwardSingle,
  onReply, onReact, scrollTargetId, onScrollTargetHandled,
  searchQuery, matchedIds, currentMatchId, pinnedFocusId,
  hasMoreMessages, loadingMore, onLoadMore,
  onVote, onRetract, onViewVoters, onEdit, meUsername, unreadCount, onMarkRead,
  onAtBottomChange, onScrollToBottomRef, onRetryMessage, onOpenDailyPrompt,
}: Props) {
  const bottomRef      = useRef<HTMLDivElement | null>(null);
  const matchRef       = useRef<HTMLDivElement | null>(null);
  const pinnedRef      = useRef<HTMLDivElement | null>(null);
  const containerRef   = useRef<HTMLDivElement | null>(null);
  const prevScrollHeightRef = useRef(0);
  const isGroup        = chat.type === 'group';
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef    = useRef(true);
  // Плавающая «пилюля» с датой текущей видимой переписки (как в Telegram):
  // появляется при прокрутке и мягко прячется в покое.
  const [floatingDate, setFloatingDate] = useState<string | null>(null);
  const [floatingVisible, setFloatingVisible] = useState(false);
  const floatingHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether we've done the initial scroll-to-first-unread for this chat
  const initialScrollDoneRef = useRef(false);
  const readDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Map of msgId → created_at for O(1) lookup during scroll
  const msgTimestampMap = useRef(new Map<string, number>());
  useEffect(() => {
    msgTimestampMap.current = new Map(messages.map(m => [m.id, m.created_at]));
  }, [messages]);
  // keep loadingMore in a ref so auto-scroll effect reads current value without re-running
  const loadingMoreRef = useRef(loadingMore);
  loadingMoreRef.current = loadingMore;

  // Reset per-chat state when chat switches
  useEffect(() => {
    initialScrollDoneRef.current = false;
    atBottomRef.current = true;
    setAtBottom(true);
  }, [chat.id]);

  // Notify parent whenever atBottom changes (drives scroll button visibility in ChatArea)
  useEffect(() => { onAtBottomChange?.(atBottom); }, [atBottom, onAtBottomChange]);

  // Register imperative scroll-to-bottom fn for parent to invoke on button click
  useEffect(() => {
    onScrollToBottomRef?.(() =>
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    );
  }, [onScrollToBottomRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Video note active-circle state ──────────────────────────────────────────
  const [activeVideoNoteId, setActiveVideoNoteId] = useState<string | null>(null);

  // Reset active circle when switching chats
  useEffect(() => { setActiveVideoNoteId(null); }, [chat.id]);

  const handleVideoNoteActivate = useCallback((msgId: string) => {
    setActiveVideoNoteId(msgId);
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-msg-id="${msgId}"]`) as HTMLElement | null;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  const handleVideoNoteEnded = useCallback((msgId: string) => {
    const idx = messages.findIndex(m => m.id === msgId);
    if (idx === -1) { setActiveVideoNoteId(null); return; }
    const next = messages[idx + 1];
    if (next?.attachment_type === 'video_note') {
      setActiveVideoNoteId(next.id);
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-msg-id="${next.id}"]`) as HTMLElement | null;
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    } else {
      setActiveVideoNoteId(null);
    }
  }, [messages]);

  // ── Sticker pack preview ────────────────────────────────────────────────────
  const [stickerPreviewPackId, setStickerPreviewPackId] = useState<string | null>(null);

  const handleStickerPackClick = useCallback(async (packId: string) => {
    try {
      const pack = await getPackById(packId);
      if (pack?.is_public) setStickerPreviewPackId(packId);
    } catch { /* private or not found — do nothing */ }
  }, []);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; msg: Message } | null>(null);
  const [emojiTarget, setEmojiTarget] = useState<{ x: number; y: number; msgId: string } | null>(null);
  const [readersTarget, setReadersTarget] = useState<{ msgId: string; reactions: MessageReaction[] } | null>(null);
  const selectedTextRef = useRef<string>('');

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [ctxMenu]);

  // Close context menu whenever selection is fully cleared
  useEffect(() => {
    if (!hasSelection) setCtxMenu(null);
  }, [hasSelection]);

  // Scroll to a specific message (e.g. clicking on a reply quote)
  useEffect(() => {
    if (!scrollTargetId) return;
    const el = document.querySelector(`[data-msg-id="${scrollTargetId}"]`) as HTMLElement | null;
    if (el) {
      requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
    onScrollTargetHandled();
  }, [scrollTargetId]); // eslint-disable-line

  // Restore scroll position after older messages are prepended
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || prevScrollHeightRef.current === 0) return;
    el.scrollTop = el.scrollTop + (el.scrollHeight - prevScrollHeightRef.current);
    prevScrollHeightRef.current = 0;
  }, [messages.length]); // eslint-disable-line

  // Auto-scroll: first load → first unread (or bottom); new messages → bottom if at bottom
  useEffect(() => {
    if (currentMatchId || pinnedFocusId || loadingMoreRef.current) return;
    if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      // Compute first unread synchronously here — avoids the race where a
      // separate ChatArea effect sets firstUnreadId AFTER this effect runs.
      const count = unreadCount ?? 0;
      const targetId = count > 0
        ? messages[Math.max(0, messages.length - count)]?.id ?? null
        : null;
      requestAnimationFrame(() => {
        if (targetId) {
          const el = document.querySelector(`[data-msg-id="${targetId}"]`) as HTMLElement | null;
          if (el) { el.scrollIntoView({ block: 'end' }); updateReadPosition(); return; }
        }
        bottomRef.current?.scrollIntoView({ block: 'end' });
        updateReadPosition();
      });
    } else if (atBottomRef.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
      requestAnimationFrame(() => updateReadPosition());
    }
  }, [messages.length, chat.id]); // eslint-disable-line

  // Find the max created_at of all messages whose bottom edge is visible in the container.
  // Uses getBoundingClientRect() — works regardless of CSS positioning of the container.
  const updateReadPosition = useCallback(() => {
    if (!onMarkRead || !containerRef.current) return;
    const el = containerRef.current;
    const containerBottom = el.getBoundingClientRect().bottom;
    const msgEls = el.querySelectorAll<HTMLElement>('[data-msg-id]');
    let maxTs = 0;
    for (const msgEl of Array.from(msgEls)) {
      if (msgEl.getBoundingClientRect().bottom <= containerBottom + 80) {
        const ts = msgTimestampMap.current.get(msgEl.dataset.msgId!);
        if (ts && ts > maxTs) maxTs = ts;
      } else {
        break; // messages are in DOM order (oldest→newest), safe to stop
      }
    }
    if (maxTs > 0) onMarkRead(maxTs);
  }, [onMarkRead]);

  // Дата самого верхнего видимого сообщения → плавающая пилюля сверху.
  const updateFloatingDate = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const msgEls = el.querySelectorAll<HTMLElement>('[data-msg-id]');
    let ts = 0;
    for (const msgEl of Array.from(msgEls)) {
      // первое сообщение, чей нижний край ещё в зоне видимости
      if (msgEl.getBoundingClientRect().bottom >= top + 4) {
        ts = msgTimestampMap.current.get(msgEl.dataset.msgId!) ?? 0;
        break;
      }
    }
    if (!ts) return;
    setFloatingDate(formatDateSeparator(ts));
    setFloatingVisible(true);
    if (floatingHideRef.current) clearTimeout(floatingHideRef.current);
    floatingHideRef.current = setTimeout(() => setFloatingVisible(false), 1300);
  }, []);

  // Сбросить таймер скрытия пилюли при размонтировании
  useEffect(() => () => { if (floatingHideRef.current) clearTimeout(floatingHideRef.current); }, []);
  // Прятать пилюлю при переключении чата
  useEffect(() => { setFloatingVisible(false); }, [chat.id]);

  // Scroll listener: track atBottom + trigger load-more when near top + read tracking
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 80;
    setAtBottom(isAtBottom);
    atBottomRef.current = isAtBottom;
    updateFloatingDate();
    if (scrollTop < 80 && hasMoreMessages && !loadingMore && prevScrollHeightRef.current === 0) {
      prevScrollHeightRef.current = scrollHeight;
      onLoadMore();
    }
    if (onMarkRead) {
      if (readDebounceRef.current) clearTimeout(readDebounceRef.current);
      // When at bottom: mark immediately; otherwise debounce 500ms
      if (isAtBottom) {
        updateReadPosition();
      } else {
        readDebounceRef.current = setTimeout(updateReadPosition, 500);
      }
    }
  }, [hasMoreMessages, loadingMore, onLoadMore, onMarkRead, updateReadPosition, updateFloatingDate]);

  useEffect(() => {
    if (currentMatchId && matchRef.current)
      matchRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentMatchId]);

  useEffect(() => {
    if (pinnedFocusId && pinnedRef.current)
      pinnedRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [pinnedFocusId]);

  const handleContextMenu = useCallback((e: React.MouseEvent, msg: Message) => {
    if (msg.is_system) return;
    e.preventDefault();
    e.stopPropagation();
    // Capture selected text BEFORE the menu opens (selection clears on some actions)
    selectedTextRef.current = window.getSelection()?.toString().trim() ?? '';
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = e.clientX;
    let y = e.clientY;
    if (x + CTX_WIDTH  > vw) x = vw - CTX_WIDTH  - 8;
    if (y + CTX_HEIGHT > vh) y = vh - CTX_HEIGHT - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    setCtxMenu({ x, y, msg });
  }, []);

  return (
    <div className="messages" ref={containerRef} onScroll={handleScroll} onClick={() => { hasSelection && onClearSelection(); setCtxMenu(null); }}>
      {/* Плавающая дата — sticky, height:0, не занимает места в потоке */}
      <div className={`msgsFloatingDate${floatingVisible && floatingDate ? ' msgsFloatingDateShow' : ''}`} aria-hidden>
        {floatingDate && <span className="msgDatePill msgDatePillFloat">{floatingDate}</span>}
      </div>
      {loadingMore && <div className="msgsLoadingMore">Загрузка истории…</div>}
      {!hasMoreMessages && messages.length > 0 && (
        <div className="msgsBeginning">— начало истории переписки —</div>
      )}
      {loadingMessages && <div className="msgHint">Загрузка…</div>}

      {messages.map((m, idx) => {
        const isOwn        = m.sender_id === meId;
        const isRead       = isOwn && partnerReadAt >= m.created_at;
        const isSelected   = selectedIds.has(m.id);
        const sender       = !isOwn ? chat.members.find(mb => mb.id === m.sender_id) : undefined;
        const nextMsg      = messages[idx + 1];
        const isLastInRow  = !nextMsg || nextMsg.sender_id !== m.sender_id;
        const showAvatar   = isGroup && !isOwn && isLastInRow && !m.is_system;
        const showName     = isGroup && !isOwn && !m.is_system &&
          (idx === 0 || messages[idx - 1].sender_id !== m.sender_id || !!messages[idx - 1].is_system);
        const isMatch      = searchQuery.length >= 1 && matchedIds.includes(m.id);
        const isFocused    = m.id === currentMatchId;
        const isPinnedFocus = m.id === pinnedFocusId;
        // Разделитель дня: перед первым сообщением и на каждой смене даты
        const showDate = idx === 0 || dayKey(m.created_at) !== dayKey(messages[idx - 1].created_at);
        const dateDivider = showDate ? (
          <div className="msgDateDivider"><span className="msgDatePill">{formatDateSeparator(m.created_at)}</span></div>
        ) : null;

        if (m.is_system && m.attachment_type === 'daily_prompt' && m.daily_prompt) {
          return (
            <div key={m.id} data-msg-id={m.id}>
              {dateDivider}
              <div className="dpCardRow">
                <DailyPromptCard m={m} onOpen={(id) => onOpenDailyPrompt?.(id)} />
              </div>
            </div>
          );
        }

        if (m.is_system) {
          return (
            <div key={m.id}>
              {dateDivider}
              <div className="msgSystem"><span>{m.text}</span></div>
            </div>
          );
        }

        return (
          <div
            key={m.id}
            data-msg-id={m.id}
            ref={isFocused ? matchRef : isPinnedFocus ? pinnedRef : null}
            onContextMenu={e => handleContextMenu(e, m)}
          >
            {dateDivider}
            <MessageBubble
              message={m}
              isOwn={isOwn}
              isRead={isRead}
              isSelected={isSelected}
              isGroup={isGroup}
              sender={sender}
              showAvatar={showAvatar}
              showName={showName}
              hasSelection={hasSelection}
              highlight={isMatch ? searchQuery : undefined}
              isSearchMatch={isFocused}
              meId={meId}
              onContextMenu={hasSelection ? () => {} : () => onToggleSelect(m.id)}
              onClick={() => onToggleSelect(m.id)}
              onViewUser={onViewUser}
              onForwardedSenderClick={onViewUser}
              onReact={(emoji) => onReact(m.id, emoji)}
              onScrollToMessage={(msgId) => {
                const el = document.querySelector(`[data-msg-id="${msgId}"]`) as HTMLElement | null;
                if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
              }}
              onVote={onVote}
              onRetract={onRetract}
              onViewVoters={onViewVoters}
              meUsername={meUsername}
              members={chat.members}
              onViewReaders={isOwn && isGroup ? () => setReadersTarget({ msgId: m.id, reactions: m.reactions ?? [] }) : undefined}
              activeVideoNoteId={activeVideoNoteId}
              onVideoNoteActivate={handleVideoNoteActivate}
              onVideoNoteEnded={handleVideoNoteEnded}
              onStickerPackClick={handleStickerPackClick}
              onRetry={m._error ? () => onRetryMessage?.(m.id) : undefined}
            />
          </div>
        );
      })}

      <div ref={bottomRef} />

      {readersTarget && (
        <MessageReadersModal
          chatId={chat.id}
          msgId={readersTarget.msgId}
          reactions={readersTarget.reactions}
          onClose={() => setReadersTarget(null)}
        />
      )}

      {stickerPreviewPackId && (
        <StickerPackPreviewModal
          packId={stickerPreviewPackId}
          onClose={() => setStickerPreviewPackId(null)}
        />
      )}

      {/* ✅ Emoji picker portal */}
      {emojiTarget && (
        <Suspense fallback={null}>
          <EmojiPicker
            x={emojiTarget.x}
            y={emojiTarget.y}
            onPick={(emoji) => { onReact(emojiTarget.msgId, emoji); }}
            onClose={() => setEmojiTarget(null)}
          />
        </Suspense>
      )}

      {/* ✅ Portal: context menu renders at document.body level */}
      {ctxMenu && (
        <Portal>
          <div
            className="msgCtxMenu"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onClick={e => e.stopPropagation()}
            onContextMenu={e => e.preventDefault()}
          >
            {(() => { const multiSelect = selectedIds.size > 1; return (<>
            {/* Reply — single message only */}
            {!multiSelect && !ctxMenu.msg.is_system && (
              <button
                className="msgCtxItem msgCtxItemReply"
                onClick={() => {
                  onReply(ctxMenu.msg, selectedTextRef.current);
                  setCtxMenu(null);
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 17 4 12 9 7"/>
                  <path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
                </svg>
                Ответить
              </button>
            )}

            {/* Copy text — single or multi (copies all selected texts joined by blank line) */}
            {!ctxMenu.msg.is_system && (multiSelect ? messages.some(m => selectedIds.has(m.id) && m.text) : (ctxMenu.msg.text && !ctxMenu.msg.attachment_url)) && (
              <button
                className="msgCtxItem"
                onClick={() => {
                  const text = multiSelect
                    ? messages.filter(m => selectedIds.has(m.id) && m.text).map(m => m.text).join('\n\n')
                    : ctxMenu.msg.text;
                  navigator.clipboard.writeText(text).catch(() => {});
                  setCtxMenu(null);
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                Копировать текст
              </button>
            )}

            {/* Edit — single message only, own text messages */}
            {!multiSelect && ctxMenu.msg.sender_id === meId && !ctxMenu.msg.attachment_url && !ctxMenu.msg.is_system && !ctxMenu.msg.poll && (
              <button
                className="msgCtxItem msgCtxItemEdit"
                onClick={() => { onEdit(ctxMenu.msg.id); setCtxMenu(null); }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                Редактировать
              </button>
            )}

            {/* React with emoji — single message only */}
            {!multiSelect && !ctxMenu.msg.is_system && (
              <button
                className="msgCtxItem msgCtxItemReact"
                onClick={() => {
                  setEmojiTarget({ x: ctxMenu.x, y: ctxMenu.y, msgId: ctxMenu.msg.id });
                  setCtxMenu(null);
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
                  <line x1="9" y1="9" x2="9.01" y2="9"/>
                  <line x1="15" y1="9" x2="15.01" y2="9"/>
                </svg>
                Поставить реакцию
              </button>
            )}</>); })()}

            {/* ✅ Forward */}
            {!ctxMenu.msg.is_system && (
              <button
                className="msgCtxItem msgCtxItemForward"
                onClick={() => { onForwardSingle(ctxMenu.msg.id); setCtxMenu(null); }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 17 20 12 15 7"/>
                  <path d="M4 18v-2a4 4 0 0 1 4-4h12"/>
                </svg>
                Переслать
              </button>
            )}

            {/* Pin / Unpin */}
            {ctxMenu.msg.is_pinned ? (
              <button
                className="msgCtxItem"
                onClick={() => { onUnpinMessage(ctxMenu.msg.id); onClearSelection(); setCtxMenu(null); }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="2" y1="2" x2="22" y2="22"/>
                  <path d="M12 17v5M9 9H4l3-3 4 1M15 15l4-4-1-4 3-3v5"/>
                </svg>
                Открепить
              </button>
            ) : (
              <button
                className="msgCtxItem msgCtxItemPin"
                onClick={() => { onPinMessage(ctxMenu.msg.id); onClearSelection(); setCtxMenu(null); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <path d="M16 3a1 1 0 0 0-1 1v1H9V4a1 1 0 0 0-2 0v1a3 3 0 0 0-3 3v1l2 2v4H4a1 1 0 0 0 0 2h7v3a1 1 0 0 0 2 0v-3h7a1 1 0 0 0 0-2h-2v-4l2-2V8a3 3 0 0 0-3-3V4a1 1 0 0 0-1-1z"/>
                </svg>
                Закрепить
              </button>
            )}

            {/* Retract vote — single message only */}
            {selectedIds.size <= 1 && ctxMenu.msg.poll && ctxMenu.msg.poll.my_votes.length > 0 && (
              <button
                className="msgCtxItem"
                onClick={() => { onRetract?.(ctxMenu.msg.id); setCtxMenu(null); }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-5.05"/>
                </svg>
                Переголосовать
              </button>
            )}

            {/* Delete — available for any message (own or others'), user chooses scope in modal */}
            {!ctxMenu.msg.is_system && (
              <button
                className="msgCtxItem msgCtxItemDanger"
                onClick={() => { onDeleteSingle(ctxMenu.msg.id); setCtxMenu(null); }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
                Удалить
              </button>
            )}
          </div>
        </Portal>
      )}

    </div>
  );
}
