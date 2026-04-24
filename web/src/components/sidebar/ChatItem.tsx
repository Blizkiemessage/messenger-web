/**
 * ChatItem — sidebar chat list row.
 * ✅ Pin indicator, mute icon + grey badge, drag-and-drop support.
 */
import { type Chat } from '../../types';
import { chatTitle, avatarLetter, formatTime } from '../../utils/format';
import { Avatar, resolveUrl } from '../ui/Avatar';
import { stripPreview } from '../../utils/markdown';
import { useStickerStore } from '../../store/useStickerStore';
import { useDraftStore } from '../../store/useDraftStore';

const CUSTOM_EMOJI_RE = /:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:/gi;

/** Split text into plain-string and custom-emoji segments */
function parseInlineEmoji(text: string, packItems: Record<string, { id: string; file_url?: string | null; thumb_url?: string | null }[]>) {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  const re = new RegExp(CUSTOM_EMOJI_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const inner = m[0].slice(1, -1);           // "packId:itemId"
    const sep   = inner.indexOf(':');
    const packId = inner.slice(0, sep);
    const itemId = inner.slice(sep + 1);
    const item = packItems[packId]?.find(it => it.id === itemId);
    const url  = item?.file_url ?? item?.thumb_url;
    if (url) {
      nodes.push(
        <img key={m.index} src={url} className="ciCustomEmojiThumb" alt="" loading="lazy" />
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Render the last-message preview line for the sidebar */
function LastMessagePreview({ msg, typingPreview }: {
  msg: Chat['last_message'];
  typingPreview?: string | null;
}) {
  const { packItems } = useStickerStore();
  if (typingPreview) {
    return <span className="ciPreview ciPreviewTyping">{typingPreview}</span>;
  }
  if (!msg) {
    return <span className="ciPreview ciPreviewMuted">Нет сообщений</span>;
  }

  const isSticker  = msg.attachment_type === 'sticker';
  const isGif      = msg.attachment_type === 'gif_tenor' || msg.attachment_type === 'gif_custom';
  const isImage    = msg.attachment_type === 'image';
  const isVideo    = msg.attachment_type === 'video';
  const isAudio    = msg.attachment_type === 'audio';
  const isVN       = msg.attachment_type === 'video_note';

  if (isSticker) {
    const url = resolveUrl(msg.attachment_url) ?? msg.attachment_url ?? '';
    return (
      <span className="ciPreview ciPreviewSticker">
        {msg.text ? <span className="ciPreviewText">{stripPreview(msg.text)}&nbsp;</span> : null}
        <img
          src={url}
          className="ciStickerThumb"
          alt="Стикер"
          loading="lazy"
        />
      </span>
    );
  }

  if (isGif) {
    return (
      <span className="ciPreview">
        <span className="ciAttachLabel">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 3 }}>
            <rect x="2" y="6" width="20" height="12" rx="2"/>
            <text x="5" y="16" fontSize="8" fontWeight="bold" fill="white">GIF</text>
          </svg>
          GIF
        </span>
      </span>
    );
  }

  if (isImage) {
    return (
      <span className="ciPreview">
        <span className="ciAttachLabel">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ marginRight: 3, flexShrink: 0 }}>
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          {msg.text ? stripPreview(msg.text) : 'Фото'}
        </span>
      </span>
    );
  }

  if (isVideo || isVN) {
    return (
      <span className="ciPreview">
        <span className="ciAttachLabel">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ marginRight: 3, flexShrink: 0 }}>
            <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
          </svg>
          {msg.text ? stripPreview(msg.text) : isVN ? 'Видеосообщение' : 'Видео'}
        </span>
      </span>
    );
  }

  if (isAudio) {
    return (
      <span className="ciPreview">
        <span className="ciAttachLabel">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ marginRight: 3, flexShrink: 0 }}>
            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
          Аудио
        </span>
      </span>
    );
  }

  if (msg.text) {
    // stripPreview resolves custom emoji to emoji_hint when packItems cached,
    // otherwise falls back to [эмодзи]. parseInlineEmoji handles any
    // remaining :packId:itemId: tokens not yet in cache.
    const stripped = stripPreview(msg.text, packItems);
    const nodes = parseInlineEmoji(stripped, packItems);
    return <span className="ciPreview">{nodes}</span>;
  }

  return <span className="ciPreview ciPreviewMuted">Вложение</span>;
}

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
  const title     = chatTitle(chat, meId);
  const isSaved   = chat.type === 'saved';
  // Show draft in sidebar for non-active chats only (active chat shows draft in composer)
  const draftText = useDraftStore(s => (!isActive ? (s.drafts[chat.id] ?? '') : ''));

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
          {draftText && !typingPreview ? (
            <span className="ciPreview">
              <span className="ciDraftLabel">Черновик:</span>
              <span className="ciPreviewText">{stripPreview(draftText)}</span>
            </span>
          ) : (
            <LastMessagePreview msg={chat.last_message} typingPreview={typingPreview} />
          )}

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
