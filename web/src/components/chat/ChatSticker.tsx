/**
 * ChatSticker — renders a sticker inside a chat bubble.
 *
 * Eagerly fetches the pack items if they aren't in the store yet so that
 * every viewer (not just the sender who has the picker open) gets the live
 * file_url instead of falling back to the potentially-stale attachment_url.
 */
import { useEffect } from 'react';
import { resolveUrl } from '../ui/Avatar';
import { StickerMedia } from '../ui/StickerMedia';
import { useStickerStore } from '../../store/useStickerStore';
import { type Message } from '../../types';

interface Props {
  m: Message;
  onStickerPackClick?: (packId: string) => void;
}

export function ChatSticker({ m, onStickerPackClick }: Props) {
  let packId: string | null = null;
  let itemId: string | null = null;
  try {
    const meta = JSON.parse(m.attachment_meta || '{}');
    packId = meta.packId ?? null;
    itemId = meta.itemId ?? null;
  } catch {}

  const { packItems, fetchPackItems } = useStickerStore();

  // If we know which pack this sticker belongs to but haven't loaded its items
  // yet, fetch them now. This ensures every recipient sees the current file_url
  // rather than the potentially-stale attachment_url stored in the message.
  useEffect(() => {
    if (packId && !packItems[packId]) {
      fetchPackItems(packId).catch(() => { /* private / deleted pack — ignore */ });
    }
  }, [packId]); // eslint-disable-line react-hooks/exhaustive-deps

  const attachmentUrl = resolveUrl(m.attachment_url) ?? m.attachment_url ?? '';
  let stickerFileUrl = attachmentUrl;
  let stickerThumb: string | null = null;

  if (packId && itemId && packItems[packId]) {
    const found = packItems[packId].find(it => it.id === itemId);
    if (found) {
      stickerFileUrl = resolveUrl(found.file_url) ?? found.file_url;
      stickerThumb = found.thumb_url ?? null;
    }
  }

  // Fallback: scan all loaded packs for a matching file_url so we at least
  // get the thumb as an error fallback even for old messages without attachment_meta.
  if (!stickerThumb && stickerFileUrl === attachmentUrl) {
    outer: for (const items of Object.values(packItems)) {
      for (const it of items) {
        if (it.file_url && (resolveUrl(it.file_url) === attachmentUrl || it.file_url === m.attachment_url)) {
          stickerThumb = it.thumb_url ?? null;
          break outer;
        }
      }
    }
  }

  const clickable = !!(packId && onStickerPackClick);

  return (
    <button
      className={`bubbleStickerBtn${clickable ? ' bubbleStickerBtnClickable' : ''}`}
      onClick={e => {
        if (!clickable) return;
        e.stopPropagation();
        onStickerPackClick!(packId!);
      }}
      title={clickable ? 'Просмотреть стикерпак' : undefined}
    >
      <StickerMedia
        fileUrl={stickerFileUrl}
        thumbUrl={stickerThumb}
        alt="Стикер"
        className="bubbleSticker"
        loading="eager"
      />
    </button>
  );
}
