/**
 * ChatHeader — with message search panel.
 * ✅ Fixed: uses Avatar component to show real photos instead of just letters.
 */
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { type Chat } from '../../types';
import { chatTitle, chatSubtitle, avatarLetter, formatLastSeen } from '../../utils/format';
import { Avatar, resolveUrl, PRESENCE_LABELS, PRESENCE_EMOJI } from '../ui/Avatar';
import { AssistantOrb } from '../ui/AssistantOrb';
import { useChatsStore } from '../../store/useChatsStore';
import { useAppStore } from '../../store/useAppStore';

interface Props {
  chat: Chat;
  meId: string;
  hasSelection: boolean;
  selectedCount: number;
  onCancelSelection: () => void;
  onDeleteSelected: () => void;
  onForwardSelected: () => void;
  onPinSelected: () => void;
  onUnpinSelected: () => void;   // ✅ new
  allSelectedPinned: boolean;    // ✅ new
  onOpenInfo: () => void;
  onViewUser: (id: string) => void;
  searchOpen: boolean;
  searchQuery: string;
  searchTotal: number;
  searchCurrent: number;
  onToggleSearch: () => void;
  // Pin navigation
  pinnedCount: number;
  pinnedOpen: boolean;
  pinnedIndex: number;
  onTogglePinned: () => void;
  onPinnedNext: () => void;
  onPinnedPrev: () => void;
  onSearchChange: (q: string) => void;
  onSearchNext: () => void;
  onSearchPrev: () => void;
  onSearchClose: () => void;
  typingText?: string;
  onOpenMedia: () => void;
  onAudioCall?: () => void;
  onVideoCall?: () => void;
  onOpenNotes?: () => void;
  onOpenSummary?: () => void;
  onOpenSettings?: () => void;
}

export function ChatHeader({
  chat, meId, hasSelection, selectedCount,
  onCancelSelection, onDeleteSelected, onForwardSelected, onPinSelected, onUnpinSelected,
  allSelectedPinned, onOpenInfo, onViewUser,
  searchOpen, searchQuery, searchTotal, searchCurrent,
  onToggleSearch, onSearchChange, onSearchNext, onSearchPrev, onSearchClose,
  pinnedCount, pinnedOpen, pinnedIndex, onTogglePinned, onPinnedNext, onPinnedPrev,
  typingText, onOpenMedia, onAudioCall, onVideoCall, onOpenNotes, onOpenSummary, onOpenSettings,
}: Props) {
  const setActiveChatId = useChatsStore(s => s.setActiveChatId);
  const setShowAssistant = useAppStore(s => s.setShowAssistant);
  const onlineUsers = useChatsStore(s => s.onlineUsers);
  const isGroup = chat.type === 'group';
  const isSaved = chat.type === 'saved';

  const [callMenuPos, setCallMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [moreMenuPos, setMoreMenuPos] = useState<{ top: number; right: number } | null>(null);
  const callBtnRef = useRef<HTMLButtonElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const callMenuDomRef = useRef<HTMLDivElement>(null);
  const moreMenuDomRef = useRef<HTMLDivElement>(null);

  function openCallMenu() {
    if (!callBtnRef.current) return;
    const r = callBtnRef.current.getBoundingClientRect();
    setCallMenuPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    setMoreMenuPos(null);
  }
  function openMoreMenu() {
    if (!moreBtnRef.current) return;
    const r = moreBtnRef.current.getBoundingClientRect();
    setMoreMenuPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    setCallMenuPos(null);
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (callBtnRef.current?.contains(t) || callMenuDomRef.current?.contains(t)) return;
      if (moreBtnRef.current?.contains(t) || moreMenuDomRef.current?.contains(t)) return;
      setCallMenuPos(null);
      setMoreMenuPos(null);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // For direct chats — the other person's user object
  const partner = !isGroup && !isSaved ? chat.members.find(m => m.id !== meId) : null;
  const isPartnerOnline = partner ? onlineUsers.has(partner.id) : false;
  const partnerPresence = partner?.presence_status ?? null;

  // ✅ Build a synthetic "user" object for the Avatar component
  // Groups use chat.avatar_url (new feature); direct chats use partner avatar; saved uses icon
  const avatarUser = isGroup
    ? { id: chat.id, display_name: chat.name, avatar_url: chat.avatar_url ?? null }
    : isSaved ? null
    : partner ?? null;

  if (hasSelection) {
    return (
      <div className="chatHeader">
        <button className="selCancelBtn" onClick={onCancelSelection}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <div className="selInfo">
          <span className="selCount">{selectedCount}</span>
          <span className="selLabel">{selectedCount === 1 ? 'сообщение выбрано' : 'сообщения выбраны'}</span>
        </div>
        <div className="selActions">
          <button className="selForwardBtn" onClick={onForwardSelected} title="Переслать">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 17 20 12 15 7"/>
              <path d="M4 18v-2a4 4 0 0 1 4-4h12"/>
            </svg>
            Переслать
          </button>
          {allSelectedPinned ? (
            <button className="selPinBtn" onClick={onUnpinSelected} title="Открепить">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="2" y1="2" x2="22" y2="22"/>
                <path d="M12 17v5M9 9H4l3-3 4 1M15 15l4-4-1-4 3-3v5"/>
              </svg>
              Открепить
            </button>
          ) : (
            <button className="selPinBtn" onClick={onPinSelected} title="Закрепить">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path d="M16 3a1 1 0 0 0-1 1v1H9V4a1 1 0 0 0-2 0v1a3 3 0 0 0-3 3v1l2 2v4H4a1 1 0 0 0 0 2h7v3a1 1 0 0 0 2 0v-3h7a1 1 0 0 0 0-2h-2v-4l2-2V8a3 3 0 0 0-3-3V4a1 1 0 0 0-1-1z"/>
              </svg>
              Закрепить
            </button>
          )}
          <button className="selDeleteBtn" onClick={onDeleteSelected}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
            Удалить
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`chatHeaderWrap${searchOpen ? ' searchOpen' : ''}`}>
      <div className="chatHeader">
        <button className="mobileBackBtn" onClick={() => setActiveChatId(null)} title="Назад">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <button
          className="chHeaderBtn"
          onClick={() => {
            if (isGroup) onOpenInfo();
            else if (partner) onViewUser(partner.id);
          }}
        >
          {/* ✅ Real avatar with photo support */}
          <div className={`chAvatarWrap${isGroup ? ' group' : ''}`}>
            {isSaved ? (
              <div className="chAvatar chAvatarSaved">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
            ) : resolveUrl(avatarUser?.avatar_url) ? (
              <Avatar user={avatarUser} size={38} radius={12} presenceStatus={partnerPresence} />
            ) : (
              <div className={`chAvatar${isGroup ? ' group' : ''}`}>
                {avatarLetter(chatTitle(chat, meId))}
              </div>
            )}
          </div>
          {/* min-width:0 + overflow:hidden are essential so the text block
              shrinks correctly and never pushes the action buttons off-screen */}
          <div className="chHeaderInfo">
            <div className="chName">{chatTitle(chat, meId)}</div>
            {isSaved ? (
              <div className="chSub">Ваши заметки</div>
            ) : typingText ? (
              <div className="chSub chSubTyping">{typingText}</div>
            ) : partnerPresence ? (
              // F3: pill is width-clamped; full note readable in the user profile.
              <div className="chSub chSubPresence">
                <span className="chPresencePill" data-status={partnerPresence}>
                  {PRESENCE_EMOJI[partnerPresence]}&nbsp;
                  <span className="chPresenceLabel">{PRESENCE_LABELS[partnerPresence]}</span>
                  {partner?.presence_note && (
                    <span className="chPresenceNote">
                      &nbsp;— {partner.presence_note}
                    </span>
                  )}
                </span>
              </div>
            ) : (
              <div className={`chSub${!isGroup && isPartnerOnline ? ' chSubOnline' : ''}`}>
                {isGroup
                  ? chatSubtitle(chat, meId)
                  : formatLastSeen(partner?.last_seen_at, isPartnerOnline)
                }
              </div>
            )}
          </div>
        </button>

        {/* ── Орб-вход в ассистента (виден на мобильном — в чате сайдбар скрыт) ─ */}
        <AssistantOrb onClick={() => setShowAssistant(true)} variant="asstOrbHeader" />

        {/* ── Call button (direct chats only) ──────────────────────────── */}
        {!isGroup && !isSaved && (onAudioCall || onVideoCall) && (
          <button
            ref={callBtnRef}
            className={`chSearchToggle${callMenuPos ? ' active' : ''}`}
            onClick={() => callMenuPos ? setCallMenuPos(null) : openCallMenu()}
            title="Позвонить"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.24h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.77a16 16 0 0 0 6.29 6.29l.95-.95a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
          </button>
        )}

        {/* ── Three-dot menu button ─────────────────────────────────────── */}
        <button
          ref={moreBtnRef}
          className={`chSearchToggle${moreMenuPos ? ' active' : ''}`}
          onClick={() => moreMenuPos ? setMoreMenuPos(null) : openMoreMenu()}
          title="Ещё"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
          </svg>
        </button>

        {/* ── Portals — rendered at body level to escape overflow/stacking ─ */}
        {callMenuPos && createPortal(
          <div
            ref={callMenuDomRef}
            className="chHeaderDropMenu"
            style={{ top: callMenuPos.top, right: callMenuPos.right }}
          >
            {onAudioCall && (
              <button className="chHeaderDropItem" onMouseDown={e => e.stopPropagation()} onClick={() => { setCallMenuPos(null); onAudioCall(); }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.24h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.77a16 16 0 0 0 6.29 6.29l.95-.95a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                </svg>
                Аудиозвонок
              </button>
            )}
            {onVideoCall && (
              <button className="chHeaderDropItem" onMouseDown={e => e.stopPropagation()} onClick={() => { setCallMenuPos(null); onVideoCall(); }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7"/>
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
                Видеозвонок
              </button>
            )}
          </div>,
          document.body
        )}

        {moreMenuPos && createPortal(
          <div
            ref={moreMenuDomRef}
            className="chHeaderDropMenu"
            style={{ top: moreMenuPos.top, right: moreMenuPos.right }}
          >
            <button className="chHeaderDropItem" onMouseDown={e => e.stopPropagation()} onClick={() => { setMoreMenuPos(null); onOpenMedia(); }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              Галерея
            </button>
            <button className="chHeaderDropItem" onMouseDown={e => e.stopPropagation()} onClick={() => { setMoreMenuPos(null); onToggleSearch(); }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              Поиск
            </button>
            <button className="chHeaderDropItem" onMouseDown={e => e.stopPropagation()} onClick={() => { setMoreMenuPos(null); onTogglePinned(); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path d="M16 3a1 1 0 0 0-1 1v1H9V4a1 1 0 0 0-2 0v1a3 3 0 0 0-3 3v1l2 2v4H4a1 1 0 0 0 0 2h7v3a1 1 0 0 0 2 0v-3h7a1 1 0 0 0 0-2h-2v-4l2-2V8a3 3 0 0 0-3-3V4a1 1 0 0 0-1-1z"/>
              </svg>
              Закреплённые{pinnedCount > 0 && <span className="chDropPinBadge">{pinnedCount}</span>}
            </button>
            {onOpenNotes && (
              <button className="chHeaderDropItem" onMouseDown={e => e.stopPropagation()} onClick={() => { setMoreMenuPos(null); onOpenNotes(); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
                Заметки
              </button>
            )}
            {onOpenSummary && (
              <button className="chHeaderDropItem" onMouseDown={e => e.stopPropagation()} onClick={() => { setMoreMenuPos(null); onOpenSummary(); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 6v6l4 2"/>
                </svg>
                AI-сводка
              </button>
            )}
            {onOpenSettings && (
              <button className="chHeaderDropItem" onMouseDown={e => e.stopPropagation()} onClick={() => { setMoreMenuPos(null); onOpenSettings(); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
                Настройки чата
              </button>
            )}
          </div>,
          document.body
        )}
      </div>

      {searchOpen && (
        <div className="chSearchBar">
          <div className="chSearchInputWrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="chSearchIcon">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              className="chSearchInput"
              placeholder="Найти сообщение…"
              value={searchQuery}
              onChange={e => onSearchChange(e.target.value)}
              autoFocus
            />
            {searchQuery && (
              <span className="chSearchCount">
                {searchTotal === 0 ? 'Не найдено' : `${searchCurrent + 1} / ${searchTotal}`}
              </span>
            )}
          </div>
          <div className="chSearchActions">
            {searchTotal > 0 && (
              <>
                <button className="chSearchNav" onClick={onSearchPrev} title="Предыдущее">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="18 15 12 9 6 15"/>
                  </svg>
                </button>
                <button className="chSearchNav" onClick={onSearchNext} title="Следующее">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
              </>
            )}
            {searchQuery && (
              <button className="chSearchReset" onClick={() => onSearchChange('')}>Сброс</button>
            )}
            <button className="chSearchClose" onClick={onSearchClose}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>
      )}
      {/* Pin navigation bar */}
      {pinnedOpen && pinnedCount > 0 && (
        <div className="chPinBar">
          <div className="chPinBarIcon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <path d="M16 3a1 1 0 0 0-1 1v1H9V4a1 1 0 0 0-2 0v1a3 3 0 0 0-3 3v1l2 2v4H4a1 1 0 0 0 0 2h7v3a1 1 0 0 0 2 0v-3h7a1 1 0 0 0 0-2h-2v-4l2-2V8a3 3 0 0 0-3-3V4a1 1 0 0 0-1-1z"/>
            </svg>
          </div>
          <div className="chPinBarLabel">
            Закреплённое <span className="chPinBarCount">{pinnedIndex + 1} / {pinnedCount}</span>
          </div>
          <div className="chPinBarActions">
            <button className="chSearchNav" onClick={onPinnedPrev} title="Предыдущее">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <button className="chSearchNav" onClick={onPinnedNext} title="Следующее">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
            <button className="chSearchClose" onClick={onTogglePinned} title="Закрыть">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
