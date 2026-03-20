import { type Message, type User } from '../../types';
import { formatTime } from '../../utils/format';
import { Avatar } from '../ui/Avatar';
import { MsgStatus } from '../ui/icons/MsgStatus';

interface Props {
  message: Message;
  isOwn: boolean;
  isRead: boolean;
  isSelected: boolean;
  isGroup: boolean;
  sender?: User;
  showAvatar: boolean;
  showName: boolean;
  hasSelection: boolean;
  highlight?: string;        // search term to highlight
  isSearchMatch?: boolean;   // this is the currently focused match
  onContextMenu: () => void;
  onClick: (e: React.MouseEvent) => void;
  onViewUser: (id: string) => void;
}

/** Wrap matched substrings in <mark> spans */
function HighlightText({ text, term }: { text: string; term: string }) {
  if (!term || !text) return <>{text}</>;
  const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === term.toLowerCase()
          ? <mark key={i} className="msgHighlight">{part}</mark>
          : part
      )}
    </>
  );
}

export function MessageBubble({
  message: m, isOwn, isRead, isSelected, isGroup, sender,
  showAvatar, showName, hasSelection, highlight, isSearchMatch,
  onContextMenu, onClick, onViewUser,
}: Props) {
  return (
    <div
      className={`msg ${isOwn ? 'out' : 'in'}${isSelected ? ' selected' : ''}${isGroup && !isOwn ? ' inGroup' : ''}${isSearchMatch ? ' msgSearchFocus' : ''}`}
      onContextMenu={e => { if (!isOwn) return; e.preventDefault(); onContextMenu(); }}
      onClick={e => { if (!isOwn || !hasSelection) return; e.stopPropagation(); onClick(e); }}
    >
      {isGroup && !isOwn && (
        <div className="msgAvatarSlot">
          {showAvatar ? (
            <button className="msgSenderAvatarBtn" onClick={e => { e.stopPropagation(); onViewUser(m.sender_id); }}>
              <Avatar user={sender} size={32} radius={10} />
            </button>
          ) : (
            <div style={{ width: 32 }} />
          )}
        </div>
      )}
      <div className="bubble">
        {isSelected && (
          <div className="msgCheckmark">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>
          </div>
        )}
        {showName && (
          <button
            className="bubbleSenderName"
            onClick={e => { e.stopPropagation(); onViewUser(m.sender_id); }}
          >
            {sender?.display_name || sender?.username || 'Пользователь'}
          </button>
        )}
        <div className="bubbleText">
          <HighlightText text={m.text || ''} term={highlight || ''} />
        </div>
        <div className="bubbleMeta">
          <span className="bubbleTime">{formatTime(m.created_at)}</span>
          {isOwn && <MsgStatus isRead={isRead} />}
        </div>
      </div>
    </div>
  );
}
