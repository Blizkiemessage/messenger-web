/**
 * MessageBubble.tsx — orchestrator for a single message bubble.
 *
 * Presentational pieces live in ./messageBubble/:
 *   helpers       — formatFileSize / file category / url helpers / custom-emoji
 *   attachments   — BubbleFileIcon, FileCard, ImageAttachment, VideoAttachment
 *   MediaPlayers  — AudioPlayer (voice), VideoNotePlayer (circular)
 *   ReactionBar   — grouped reaction chips
 *   QuotedText    — reply-quote expander
 *
 * ✅ resolveUrl applied to attachment URLs so /uploads/ paths resolve to the
 *    backend instead of the frontend (Vercel SPA rewrite).
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getLinkPreview, type LinkPreview } from '../../api/linkPreview';
import { type Message, type User } from '../../types';
import { formatTime } from '../../utils/format';
import { renderMarkdown } from '../../utils/markdown';
import { Avatar, resolveUrl } from '../ui/Avatar';
import { ChatSticker } from './ChatSticker';
import { MsgStatus } from '../ui/icons/MsgStatus';
import { PollBubble } from './PollBubble';
import { useStickerStore } from '../../store/useStickerStore';
import { extractFirstUrl } from './messageBubble/helpers';
import { FileCard, ImageAttachment, VideoAttachment } from './messageBubble/attachments';
import { AudioPlayer, VideoNotePlayer } from './messageBubble/MediaPlayers';
import { ReactionBar } from './messageBubble/ReactionBar';
import { QuotedText } from './messageBubble/QuotedText';

// ── Props ─────────────────────────────────────────────────────────────────────
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
  highlight?: string;
  isSearchMatch?: boolean;
  meId: string;
  onContextMenu: () => void;
  onClick: (e: React.MouseEvent) => void;
  onViewUser: (id: string) => void;
  onForwardedSenderClick?: (userId: string) => void;
  onReact: (emoji: string) => void;
  onScrollToMessage: (msgId: string) => void;
  onVote?: (msgId: string, optionIds: string[]) => void;
  onRetract?: (msgId: string) => void;
  onViewVoters?: (pollId: string, optionId: string) => void;
  meUsername?: string;
  members?: User[];
  onViewReaders?: () => void;
  activeVideoNoteId?: string | null;
  onVideoNoteActivate?: (msgId: string) => void;
  onVideoNoteEnded?: (msgId: string) => void;
  onStickerPackClick?: (packId: string) => void;
  /** Called when user taps the error badge to retry a failed optimistic send. */
  onRetry?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function MessageBubble({
  message: m, isOwn, isRead, isSelected, isGroup, sender,
  showAvatar, showName, hasSelection, highlight, isSearchMatch,
  meId, onContextMenu, onClick, onViewUser, onForwardedSenderClick,
  onReact, onScrollToMessage, onVote, onRetract, onViewVoters, meUsername, members, onViewReaders,
  activeVideoNoteId, onVideoNoteActivate, onVideoNoteEnded, onStickerPackClick,
  onRetry,
}: Props) {
  const { t } = useTranslation(['chat', 'nav']);
  const hasAttachment = !!m.attachment_url;
  const isImage     = m.attachment_type === 'image';
  const isVideo     = m.attachment_type === 'video';
  const isAudio     = m.attachment_type === 'audio';
  const isVideoNote = m.attachment_type === 'video_note';
  const isGifTenor  = m.attachment_type === 'gif_tenor';
  const isSticker   = m.attachment_type === 'sticker';
  const isFile      = hasAttachment && !isImage && !isVideo && !isAudio && !isVideoNote && !isGifTenor && !isSticker;

  // Custom emoji resolver — reads from store cache (non-reactive, uses getState)
  const { packItems } = useStickerStore();
  const emojiResolver = useCallback((packId: string, itemId: string): string | null => {
    const items = packItems[packId];
    return items?.find(it => it.id === itemId)?.file_url ?? null;
  }, [packItems]);

  // Display name used in the mini player bar
  const playerSenderName = isOwn
    ? t('chat:bubble.you')
    : (sender?.display_name ?? sender?.username ?? t('nav:common.defaultUser'));

  // Link preview
  const firstUrl = useMemo(() => extractFirstUrl(m.text), [m.text]);
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  useEffect(() => {
    if (!firstUrl) return;
    let cancelled = false;
    getLinkPreview(firstUrl).then(p => {
      if (!cancelled && p.title) setPreview(p);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [firstUrl]);

  // ✅ KEY FIX: resolve /uploads/... URLs to absolute backend URLs.
  // Without this, Vercel's SPA rewrite catches the relative path and serves index.html.
  const attachmentUrl = resolveUrl(m.attachment_url) ?? m.attachment_url ?? '';

  const caption  = hasAttachment && m.text ? m.text : undefined;
  const pureText = hasAttachment ? null : m.text;

  return (
    <div
      className={[
        'msg', isOwn ? 'out' : 'in',
        isSelected    ? 'selected'    : '',
        isGroup && !isOwn ? 'inGroup' : '',
        isSearchMatch ? 'msgSearchFocus' : '',
      ].filter(Boolean).join(' ')}
      onContextMenu={e => { if (m.is_system) return; e.preventDefault(); onContextMenu(); }}
      onClick={e => { if (!hasSelection) return; e.stopPropagation(); onClick(e); }}
      onDoubleClick={e => { if (!m.is_system && !hasSelection) { e.stopPropagation(); onReact('❤️'); } }}
    >
      {isGroup && !isOwn && (
        <div className="msgAvatarSlot">
          {showAvatar ? (
            <button className="msgSenderAvatarBtn"
                    onClick={e => { e.stopPropagation(); onViewUser(m.sender_id); }}>
              <Avatar user={sender} size={32} radius={10} />
            </button>
          ) : (
            <div style={{ width: 32 }} />
          )}
        </div>
      )}

      <div className={[
        'bubble',
        hasAttachment && !isVideoNote && !isGifTenor && !isSticker ? 'bubbleWithAttach' : '',
        isVideoNote ? 'bubbleVideoNote' : '',
        isSticker ? 'bubbleNoBackground' : '',
      ].filter(Boolean).join(' ')}>
        {/* ✅ Pin indicator — thumbtack icon */}
        {m.is_pinned && !isSelected && (
          <div className="msgPinBadge" title={t('chat:bubble.pinnedMessage')}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <path d="M16 3a1 1 0 0 0-1 1v1H9V4a1 1 0 0 0-2 0v1a3 3 0 0 0-3 3v1l2 2v4H4a1 1 0 0 0 0 2h7v3a1 1 0 0 0 2 0v-3h7a1 1 0 0 0 0-2h-2v-4l2-2V8a3 3 0 0 0-3-3V4a1 1 0 0 0-1-1z"/>
            </svg>
          </div>
        )}
        {isSelected && (
          <div className="msgCheckmark">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>
          </div>
        )}

        {showName && (
          <button className="bubbleSenderName"
                  onClick={e => { e.stopPropagation(); onViewUser(m.sender_id); }}>
            {sender?.display_name || sender?.username || t('nav:common.defaultUser')}
          </button>
        )}

        {/* ✅ Reply/Quote block */}
        {m.reply && (
          <div
            className="bubbleReply"
            onClick={e => { e.stopPropagation(); onScrollToMessage(m.reply!.id); }}
          >
            {m.reply.sender_id && (
              <button
                className="bubbleReplySender"
                onClick={e => { e.stopPropagation(); onViewUser(m.reply!.sender_id!); }}
              >
                {m.reply.sender_username || t('nav:common.defaultUser')}
              </button>
            )}
            <div className="bubbleReplyText">
              <QuotedText text={m.reply.text} />
            </div>
          </div>
        )}

        {/* ✅ Forwarded-from badge */}
        {m.forwarded_from_user_id && (
          <div className="bubbleForwardedBadge">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 17 20 12 15 7"/>
              <path d="M4 18v-2a4 4 0 0 1 4-4h12"/>
            </svg>
            <span>{t('chat:bubble.forwardedFrom')} </span>
            <button
              className="bubbleForwardedName"
              onClick={e => {
                e.stopPropagation();
                if (onForwardedSenderClick && m.forwarded_from_user_id) {
                  onForwardedSenderClick(m.forwarded_from_user_id);
                }
              }}
            >
              {m.forwarded_from_username || t('nav:common.defaultUser')}
            </button>
          </div>
        )}

        {/* ── Attachments (all use resolved URL) ── */}
        {isVideoNote && (
          <VideoNotePlayer
            url={attachmentUrl}
            msgId={m.id}
            isActive={activeVideoNoteId === m.id}
            onActivate={onVideoNoteActivate ?? (() => {})}
            onEnded={onVideoNoteEnded ?? (() => {})}
            isOwn={isOwn}
            isRead={isRead}
            sendTime={m.created_at}
            isGroup={isGroup}
            onViewReaders={onViewReaders}
            senderName={playerSenderName}
            initialDuration={m.attachment_duration ?? undefined}
            isPending={m._pending}
            isError={m._error}
            onRetry={onRetry}
          />
        )}
        {isAudio && (
          <AudioPlayer
            url={attachmentUrl}
            isOwn={isOwn}
            isRead={isRead}
            sendTime={m.created_at}
            msgId={m.id}
            senderName={playerSenderName}
            initialDuration={m.attachment_duration ?? undefined}
            waveformStr={m.voice_waveform ?? null}
            isPending={m._pending}
            isError={m._error}
            onRetry={onRetry}
          />
        )}
        {isImage && (
          <ImageAttachment
            url={attachmentUrl}
            name={m.attachment_name || 'image'}
            size={m.attachment_size}
            caption={caption}
            isOwn={isOwn}
          />
        )}
        {isVideo && (
          <VideoAttachment
            url={attachmentUrl}
            caption={caption}
            name={m.attachment_name || undefined}
          />
        )}
        {isGifTenor && (
          <img
            className="bubbleGif"
            src={attachmentUrl}
            alt="GIF"
            loading="lazy"
          />
        )}
        {isFile && (
          <FileCard
            url={attachmentUrl}
            name={m.attachment_name || 'file'}
            size={m.attachment_size}
            isOwn={isOwn}
            caption={caption}
          />
        )}
        {isSticker && (
          <ChatSticker m={m} onStickerPackClick={onStickerPackClick} />
        )}

        {/* Poll bubble */}
        {m.poll && (
          <PollBubble
            poll={m.poll}
            meId={meId}
            onVote={optionIds => onVote?.(m.id, optionIds)}
            onRetract={() => onRetract?.(m.id)}
            onViewVoters={optId => onViewVoters?.(m.poll!.id, optId)}
          />
        )}

        {/* Plain text */}
        {!m.poll && pureText && (
          <div className="bubbleText">
            {renderMarkdown(pureText, { term: highlight, meUsername, members, onMentionClick: onViewUser, emojiResolver })}
          </div>
        )}

        {/* Link preview card */}
        {preview && firstUrl && (
          <a href={firstUrl} target="_blank" rel="noopener noreferrer"
             className="linkPreviewCard" onClick={e => e.stopPropagation()}>
            {preview.image && (
              <img src={preview.image} className="linkPreviewImg" alt=""
                   onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
            )}
            <div className="linkPreviewBody">
              <div className="linkPreviewDomain">
                {(() => { try { return new URL(firstUrl).hostname.replace(/^www\./, ''); } catch { return firstUrl; } })()}
              </div>
              <div className="linkPreviewTitle">{preview.title}</div>
              {preview.description && (
                <div className="linkPreviewDesc">{preview.description}</div>
              )}
            </div>
          </a>
        )}

        {!isAudio && !isVideoNote && (
          <div className="bubbleFooter">
            {(m.reactions?.length ?? 0) > 0 && (
              <ReactionBar
                reactions={m.reactions!}
                meId={meId}
                isOwn={isOwn}
                onReact={onReact}
              />
            )}
            <div className="bubbleMeta">
              {m.edited_at && <span className="bubbleEdited">{t('chat:bubble.edited')}</span>}
              <span className="bubbleTime">{formatTime(m.created_at)}</span>
              {isOwn && isGroup && onViewReaders && (
                <button
                  className="bubbleReadersBtn"
                  onClick={e => { e.stopPropagation(); onViewReaders(); }}
                  title={t('chat:bubble.whoRead')}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </button>
              )}
              {isOwn && <MsgStatus isRead={isRead} isPending={m._pending} isError={m._error} onRetry={onRetry} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
