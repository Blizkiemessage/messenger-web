import { type Chat } from '../../types';
import { chatTitle, chatSubtitle, avatarLetter } from '../../utils/format';

interface Props {
  chat: Chat;
  meId: string;
  hasSelection: boolean;
  selectedCount: number;
  onCancelSelection: () => void;
  onDeleteSelected: () => void;
  onOpenInfo: () => void;
  onViewUser: (id: string) => void;
}

export function ChatHeader({
  chat, meId, hasSelection, selectedCount,
  onCancelSelection, onDeleteSelected, onOpenInfo, onViewUser,
}: Props) {
  const isGroup = chat.type === 'group';

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
    </div>
  );
}
