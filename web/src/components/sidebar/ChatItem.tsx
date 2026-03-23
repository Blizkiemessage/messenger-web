/**
 * ChatItem — sidebar chat list row.
 * ✅ Fixed: shows real avatar photo instead of letter-only placeholder.
 */
import { type Chat } from '../../types';
import { chatTitle, avatarLetter, formatTime } from '../../utils/format';
import { Avatar, resolveUrl } from '../ui/Avatar';

interface Props {
  chat: Chat;
  meId: string;
  isActive: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export function ChatItem({ chat, meId, isActive, onClick, onContextMenu }: Props) {
  const title = chatTitle(chat, meId);

  // For direct chats — partner's user object; for groups — synthetic object with group avatar
  const avatarUser = chat.type === 'group'
    ? { id: chat.id, display_name: chat.name, avatar_url: chat.avatar_url ?? null }
    : chat.members.find(m => m.id !== meId) ?? null;

  const hasPhoto = !!resolveUrl(avatarUser?.avatar_url);

  return (
    <button
      className={`chatItem${isActive ? ' active' : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {/* ✅ Real avatar with photo support */}
      <div className={`ciAvatar${chat.type === 'group' ? ' group' : ''}${hasPhoto ? ' ciAvatarPhoto' : ''}`}>
        {hasPhoto
          ? <Avatar user={avatarUser} size={42} radius={13} />
          : avatarLetter(title)
        }
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
