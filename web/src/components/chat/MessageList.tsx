/**
 * MessageList
 * ✅ Context menu uses ReactDOM.createPortal via <Portal> — renders directly
 *    into document.body so it escapes overflow/transform stacking contexts.
 */
import { useRef, useEffect, useState, useCallback } from 'react';
import { type Message, type Chat } from '../../types';
import { MessageBubble } from './MessageBubble';
import { Portal } from '../ui/Portal';

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
  searchQuery: string;
  matchedIds: string[];
  currentMatchId: string | null;
  pinnedFocusId: string | null;
}

const CTX_WIDTH  = 200;
const CTX_HEIGHT = 110;

export function MessageList({
  messages, chat, meId, partnerReadAt, selectedIds, hasSelection,
  loadingMessages, onToggleSelect, onClearSelection, onViewUser,
  onPinMessage, onUnpinMessage,
  searchQuery, matchedIds, currentMatchId, pinnedFocusId,
}: Props) {
  const bottomRef  = useRef<HTMLDivElement | null>(null);
  const matchRef   = useRef<HTMLDivElement | null>(null);
  const pinnedRef  = useRef<HTMLDivElement | null>(null);
  const isGroup    = chat.type === 'group';

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; msg: Message } | null>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click',       close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('keydown',     (e) => e.key === 'Escape' && close());
    return () => {
      window.removeEventListener('click',       close);
      window.removeEventListener('contextmenu', close);
    };
  }, [ctxMenu]);

  useEffect(() => {
    if (!currentMatchId && !pinnedFocusId)
      bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, chat.id]); // eslint-disable-line

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
    <div className="messages" onClick={() => { hasSelection && onClearSelection(); }}>
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

        if (m.is_system) {
          return (
            <div key={m.id} className="msgSystem"><span>{m.text}</span></div>
          );
        }

        return (
          <div
            key={m.id}
            ref={isFocused ? matchRef : isPinnedFocus ? pinnedRef : null}
            onContextMenu={e => handleContextMenu(e, m)}
          >
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
              onContextMenu={() => onToggleSelect(m.id)}
              onClick={() => onToggleSelect(m.id)}
              onViewUser={onViewUser}
            />
          </div>
        );
      })}

      <div ref={bottomRef} />

      {/* ✅ Portal: renders context menu at document.body level,
           escaping overflow-y:auto on .messages and overflow:hidden on .chatArea */}
      {ctxMenu && (
        <Portal>
          <div
            className="msgCtxMenu"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onClick={e => e.stopPropagation()}
            onContextMenu={e => e.preventDefault()}
          >
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
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <path d="M16 3a1 1 0 0 0-1 1v1H9V4a1 1 0 0 0-2 0v1a3 3 0 0 0-3 3v1l2 2v4H4a1 1 0 0 0 0 2h7v3a1 1 0 0 0 2 0v-3h7a1 1 0 0 0 0-2h-2v-4l2-2V8a3 3 0 0 0-3-3V4a1 1 0 0 0-1-1z"/>
                </svg>
                Закрепить
              </button>
            )}
            {ctxMenu.msg.sender_id === meId && (
              <button
                className="msgCtxItem msgCtxItemDanger"
                onClick={() => { onToggleSelect(ctxMenu.msg.id); setCtxMenu(null); }}
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
