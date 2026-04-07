/**
 * ChatItem — sidebar chat list row.
 * ✅ Pin indicator, mute icon + grey badge, drag-and-drop support.
 */
import { type Chat } from '../../types';
import { chatTitle, avatarLetter, formatTime } from '../../utils/format';
import { Avatar, resolveUrl } from '../ui/Avatar';
import { stripPreview } from '../../utils/markdown';

interface Props {
  chat: Chat;
  meId: string;
  isActive: boolean;
  isOnline?: boolean;
  typingPreview?: string | null;
  // Drag-and-drop (pinned only)
  draggable?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export function ChatItem({
  chat, meId, isActive, isOnline, typingPreview,
  draggable, isDragging, isDragOver,
  onDragStart, onDragOver, onDrop, onDragEnd,
  onClick, onContextMenu,
}: Props) {
  const title   = chatTitle(chat, meId);
  const isSaved = chat.type === 'saved';

  const avatarUser = chat.type === 'group'
    ? { id: chat.id, display_name: chat.name, avatar_url: chat.avatar_url ?? null }
    : isSaved ? null
    : chat.members.find(m => m.id !== meId) ?? null;

  const hasPhoto  = !isSaved && !!resolveUrl(avatarUser?.avatar_url);
  const hasUnread = typeof chat.unread_count === 'number' && chat.unread_count > 0;

  // Build class list
  let cls = 'chatItem';
  if (isActive)   cls += ' active';
  if (isDragging) cls += ' ciDragging';
  if (isDragOver) cls += ' ciDragOver';
  if (draggable)  cls += ' ciDraggable';

  return (
    <button
      className={cls}
      onClick={onClick}
      onContextMenu={onContextMenu}
      draggable={draggable}
      onDragStart={draggable ? (e => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(); }) : undefined}
      onDragOver={draggable ? onDragOver : undefined}
      onDrop={draggable ? (e => { e.preventDefault(); onDrop?.(); }) : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
    >
      {/* Avatar */}
      <div className="ciAvatarWrap">
        {isSaved ? (
          <div className="ciAvatar ciAvatarSaved">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
        ) : (
          <div className={`ciAvatar${chat.type === 'group' ? ' group' : ''}${hasPhoto ? ' ciAvatarPhoto' : ''}`}>
            {hasPhoto
              ? <Avatar user={avatarUser} size={42} radius={13} />
              : avatarLetter(title)
            }
          </div>
        )}
        {isOnline && chat.type === 'direct' && <span className="ciOnlineDot" />}
      </div>

      <div className="ciBody">
        <div className="ciTop">
          <span className="ciName">{title}</span>
          <span className="ciTime">{chat.last_message ? formatTime(chat.last_message.created_at) : ''}</span>
        </div>

        <div className="ciBottom">
          <span className={`ciPreview${typingPreview ? ' ciPreviewTyping' : ''}`}>
            {typingPreview
              ? typingPreview
              : chat.last_message?.text
                ? stripPreview(chat.last_message.text)
                : (chat.last_message ? 'Вложение' : 'Нет сообщений')}
          </span>

          {/* Right slot: mute icon + pin icon (if no unread) + badge */}
          <div className="ciRightSlot">
            {chat.is_muted && (
              <svg className="ciMuteIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                <line x1="2" y1="2" x2="22" y2="22"/>
              </svg>
            )}
            {chat.is_pinned && !hasUnread && (
              <svg className="ciPinIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="17" x2="12" y2="22"/>
                <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>
              </svg>
            )}
            {hasUnread && (
              <span className={`ciBadge${chat.is_muted ? ' ciBadgeMuted' : ''}`}>
                {chat.unread_count}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
