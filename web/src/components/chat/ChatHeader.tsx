<<<<<<< HEAD
import { type Chat } from '../../types';
import { chatTitle, chatSubtitle, avatarLetter } from '../../utils/format';
=======
/**
 * ChatHeader — with message search panel.
 * ✅ Fixed: uses Avatar component to show real photos instead of just letters.
 */
import { type Chat } from '../../types';
import { chatTitle, chatSubtitle, avatarLetter } from '../../utils/format';
import { Avatar, resolveUrl } from '../ui/Avatar';
>>>>>>> devDK

interface Props {
  chat: Chat;
  meId: string;
  hasSelection: boolean;
  selectedCount: number;
  onCancelSelection: () => void;
  onDeleteSelected: () => void;
  onOpenInfo: () => void;
  onViewUser: (id: string) => void;
<<<<<<< HEAD
=======
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
>>>>>>> devDK
}

export function ChatHeader({
  chat, meId, hasSelection, selectedCount,
  onCancelSelection, onDeleteSelected, onOpenInfo, onViewUser,
<<<<<<< HEAD
}: Props) {
  const isGroup = chat.type === 'group';

=======
  searchOpen, searchQuery, searchTotal, searchCurrent,
  onToggleSearch, onSearchChange, onSearchNext, onSearchPrev, onSearchClose,
  pinnedCount, pinnedOpen, pinnedIndex, onTogglePinned, onPinnedNext, onPinnedPrev,
}: Props) {
  const isGroup = chat.type === 'group';

  // For direct chats — the other person's user object
  const partner = !isGroup ? chat.members.find(m => m.id !== meId) : null;

  // ✅ Build a synthetic "user" object for the Avatar component
  // Groups use chat.avatar_url (new feature); direct chats use partner avatar
  const avatarUser = isGroup
    ? { id: chat.id, display_name: chat.name, avatar_url: chat.avatar_url ?? null }
    : partner ?? null;

>>>>>>> devDK
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
    );
  }

  return (
<<<<<<< HEAD
    <div className="chatHeader">
      <button
        className="chHeaderBtn"
        onClick={() => {
          if (isGroup) {
            onOpenInfo();
          } else {
            const other = chat.members.find(m => m.id !== meId);
            if (other) onViewUser(other.id);
          }
        }}
      >
        <div className={`chAvatar${isGroup ? ' group' : ''}`}>
          {avatarLetter(chatTitle(chat, meId))}
        </div>
        <div>
          <div className="chName">{chatTitle(chat, meId)}</div>
          <div className="chSub">{chatSubtitle(chat, meId)}</div>
        </div>
      </button>
=======
    <div className={`chatHeaderWrap${searchOpen ? ' searchOpen' : ''}`}>
      <div className="chatHeader">
        <button
          className="chHeaderBtn"
          onClick={() => {
            if (isGroup) onOpenInfo();
            else if (partner) onViewUser(partner.id);
          }}
        >
          {/* ✅ Real avatar with photo support */}
          <div className={`chAvatarWrap${isGroup ? ' group' : ''}`}>
            {resolveUrl(avatarUser?.avatar_url) ? (
              <Avatar user={avatarUser} size={38} radius={12} />
            ) : (
              <div className={`chAvatar${isGroup ? ' group' : ''}`}>
                {avatarLetter(chatTitle(chat, meId))}
              </div>
            )}
          </div>
          <div>
            <div className="chName">{chatTitle(chat, meId)}</div>
            <div className="chSub">{chatSubtitle(chat, meId)}</div>
          </div>
        </button>

        {/* ✅ Pin button — always visible, shows badge when messages are pinned */}
        <button
          className={`chSearchToggle${pinnedOpen ? ' active' : ''}${pinnedCount === 0 ? ' chPinBtnEmpty' : ''}`}
          onClick={onTogglePinned}
          title={pinnedCount > 0 ? `Закреплённые (${pinnedCount})` : 'Нет закреплённых'}
          style={{ position: 'relative' }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M16 3a1 1 0 0 0-1 1v1H9V4a1 1 0 0 0-2 0v1a3 3 0 0 0-3 3v1l2 2v4H4a1 1 0 0 0 0 2h7v3a1 1 0 0 0 2 0v-3h7a1 1 0 0 0 0-2h-2v-4l2-2V8a3 3 0 0 0-3-3V4a1 1 0 0 0-1-1z"/>
          </svg>
          {pinnedCount > 0 && <span className="chPinCount">{pinnedCount}</span>}
        </button>

        <button
          className={`chSearchToggle${searchOpen ? ' active' : ''}`}
          onClick={onToggleSearch}
          title="Поиск по сообщениям"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
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
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 17v5"/><path d="M9 4l-3 3 4 1-4 4h8l-4-4 4-1-3-3z"/>
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
>>>>>>> devDK
    </div>
  );
}
