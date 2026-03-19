import { type Chat } from '../../types';
import { chatTitle, avatarLetter, formatTime } from '../../utils/format';

interface Props {
  chat: Chat;
  meId: string;
  isActive: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export function ChatItem({ chat, meId, isActive, onClick, onContextMenu }: Props) {
  const title = chatTitle(chat, meId);
  return (
    <button
      className={`chatItem${isActive ? ' active' : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <div className={`ciAvatar${chat.type === 'group' ? ' group' : ''}`}>
        {avatarLetter(title)}
      </div>
      <div className="ciBody">
        <div className="ciTop">
          <span className="ciName">{title}</span>
          {chat.last_message && (
            <span className="ciTime">{formatTime(chat.last_message.created_at)}</span>
          )}
        </div>
        <div className="ciBottom">
          <span className="ciPreview">
            {chat.last_message?.text || (chat.last_message ? 'Вложение' : 'Нет сообщений')}
          </span>
          {typeof chat.unread_count === 'number' && chat.unread_count > 0 && (
            <span className="ciBadge">{chat.unread_count}</span>
          )}
        </div>
      </div>
    </button>
  );
}
